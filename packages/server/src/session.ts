import { randomBytes, randomUUID } from "node:crypto";
import type {
  ActiveQuestion,
  GameFixture,
  FeedEvent,
  MatchEvent,
  GoalOdds,
  PendingQuestion,
  QuestionResult,
  QuestionType,
  SessionState,
  SessionMode,
  SessionStatus,
  TeamCode,
} from "@matchpot/shared";
import { DEMO_FIXTURES, KICKOFF_GRACE_MS } from "@matchpot/shared";
import { createFeed, type MatchFeed } from "./feed";

const MAX_PLAYERS = 2;
const INITIAL_ODDS: GoalOdds = { HOME: 2.9, AWAY: 1.72 };
/** Goal questions pay 100 × the TXODDS-derived odds at lock-in. */
const BASE_POINTS = 100;
/** Card/corner questions pay a flat rate (no TXODDS market for them yet). */
const FLAT_POINTS = 150;

// Question pacing, in match minutes. At the default tempo (800 ms per match
// minute) a 12' window ≈ 10 real seconds to answer; ~4–6 questions per match.
// Tune per venue: QUESTION_WINDOW=15 QUESTION_MIN_GAP=20 pnpm dev
const ANSWER_WINDOW = Number(process.env.QUESTION_WINDOW ?? 12);
const MIN_GAP = Number(process.env.QUESTION_MIN_GAP ?? 14);
const FIRST_QUESTION_DELAY = () => 2 + Math.floor(Math.random() * 4); // 2'–5'
const QUESTION_GAP = () => MIN_GAP + Math.floor(Math.random() * 11); // MIN_GAP–MIN_GAP+10
const LAST_QUESTION_MINUTE = 82;

interface QuestionSpec {
  text: string;
  /** Returns the winning team if this event settles the question. */
  matches(event: MatchEvent): TeamCode | null;
  headline(event: MatchEvent, teamName: string): string;
  usesOdds: boolean;
}

const QUESTION_SPECS: Record<QuestionType, QuestionSpec> = {
  NEXT_GOAL: {
    text: "Who scores the next goal?",
    matches: (e) => (e.kind === "GOAL" ? e.team : null),
    headline: (e, teamName) =>
      e.kind === "GOAL"
        ? `⚽ ${e.scorer || "Goal"} — ${teamName} (${e.minute}')`
        : "",
    usesOdds: true,
  },
  NEXT_CARD: {
    text: "Which team picks up the next card?",
    matches: (e) => (e.kind === "CARD" ? e.team : null),
    headline: (e, teamName) =>
      e.kind === "CARD"
        ? `${e.card === "red" ? "🟥" : "🟨"} ${e.player ? `${e.player} — ` : ""}${teamName} (${e.minute}')`
        : "",
    usesOdds: false,
  },
  NEXT_CORNER: {
    text: "Who wins the next corner?",
    matches: (e) => (e.kind === "CORNER" ? e.team : null),
    headline: (e, teamName) =>
      e.kind === "CORNER" ? `🚩 Corner — ${teamName} (${e.minute}')` : "",
    usesOdds: false,
  },
};

const QUESTION_TYPES = Object.keys(QUESTION_SPECS) as QuestionType[];

interface PlayerInternal {
  id: string;
  name: string;
  wallet: string;
  score: number;
  connected: boolean;
  isBot: boolean;
}

interface Prediction {
  team: TeamCode;
  /** Odds snapshot at lock-in — determines the payout for odds-based questions. */
  odds: number;
}

interface QuestionInternal {
  id: string;
  type: QuestionType;
  text: string;
  openedAtMinute: number;
  lockAtMinute: number;
}

type JoinResult = { ok: true; playerId: string } | { ok: false; error: string };
type ActionResult = { ok: true } | { ok: false; error: string };

export class Session {
  status: SessionStatus = "lobby";
  hostId = "";

  private players = new Map<string, PlayerInternal>();
  private minute = 0;
  private score: Record<TeamCode, number> = { HOME: 0, AWAY: 0 };
  private odds: GoalOdds = { ...INITIAL_ODDS };
  private feed: MatchEvent[] = [];
  private active: QuestionInternal | null = null;
  private pending: QuestionInternal[] = [];
  private predictions = new Map<string, Map<string, Prediction>>();
  private results: QuestionResult[] = [];
  private winners: string[] | null = null;
  private noContest = false;
  private payoutSignature: string | null = null;
  private refundComplete = false;
  private refundSignature: string | null = null;
  private matchFeed: MatchFeed | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private starting = false;
  private questionCount = 0;
  private nextOpenMinute = 0;
  private lastType: QuestionType | null = null;

  constructor(
    readonly code: string,
    readonly escrowId: string,
    readonly fixture: GameFixture,
    readonly mode: SessionMode,
    private readonly notify: (session: Session) => void,
  ) {
    if (fixture.status === "upcoming" && fixture.startsAt) {
      this.scheduleExpiry();
    }
  }

  join(rawName: string, wallet: string): JoinResult {
    const name = rawName.trim();
    if (!name) return { ok: false, error: "Enter a name first." };
    if (
      !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet) &&
      !(this.mode === "practice" && wallet.startsWith("guest:"))
    )
      return { ok: false, error: "Connect a valid Solana wallet first." };

    // Wallet ownership reclaims a seat; names alone are not safe identity once
    // a real prize pool is attached to the game.
    const existing = [...this.players.values()].find((p) => p.wallet === wallet);
    if (existing) {
      existing.connected = true;
      this.notify(this);
      return { ok: true, playerId: existing.id };
    }

    if ([...this.players.values()].some((p) => p.name.toLowerCase() === name.toLowerCase()))
      return { ok: false, error: "That name is already taken in this session." };

    if (this.status !== "lobby") return { ok: false, error: "That match has already kicked off." };
    if (this.players.size >= MAX_PLAYERS)
      return { ok: false, error: `Session is full (${MAX_PLAYERS} players).` };

    const id = randomUUID();
    this.players.set(id, { id, name, wallet, score: 0, connected: true, isBot: false });
    if (this.players.size === 1) this.hostId = id;
    this.notify(this);
    return { ok: true, playerId: id };
  }

  addBot() {
    if (this.mode !== "practice" || this.players.size !== 1) return;
    const id = `bot:${this.code}`;
    this.players.set(id, {
      id,
      name: "MatchBot",
      wallet: id,
      score: 0,
      connected: true,
      isBot: true,
    });
    this.notify(this);
  }

  start(playerId: string): ActionResult {
    if (!this.starting || playerId !== this.hostId)
      return { ok: false, error: "Kickoff was not prepared." };

    let feed: MatchFeed;
    try {
      feed = createFeed(this.fixture);
    } catch (err) {
      this.abortStart();
      return { ok: false, error: err instanceof Error ? err.message : "Feed unavailable." };
    }

    this.status = "live";
    this.starting = false;
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    this.nextOpenMinute = FIRST_QUESTION_DELAY();
    this.matchFeed = feed;
    // Move every lobby client to the match screen immediately. Historical
    // TxLINE preparation can take a few seconds before its first feed event.
    this.notify(this);
    this.matchFeed.start({
      onMinute: (minute) => this.handleMinute(minute),
      onEvent: (event) => this.handleFeedEvent(event),
    });
    return { ok: true };
  }

  startReadinessError(playerId: string): string | null {
    if (this.starting) return "Kickoff is already being prepared.";
    if (this.status === "expired") return "This session expired without enough deposits.";
    if (this.status !== "lobby") return "Match already started.";
    if (playerId !== this.hostId) return "Only the host can kick off.";
    if (this.players.size < MAX_PLAYERS) return "Waiting for your friend to join.";
    if (
      this.fixture.status === "upcoming" &&
      this.fixture.startsAt &&
      Date.now() < this.fixture.startsAt
    ) {
      return `${this.fixture.home.name} vs ${this.fixture.away.name} starts ${formatTimeUntil(this.fixture.startsAt)}.`;
    }
    return null;
  }

  beginStart(playerId: string): ActionResult {
    const readinessError = this.startReadinessError(playerId);
    if (readinessError) return { ok: false, error: readinessError };
    this.starting = true;
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    return { ok: true };
  }

  abortStart() {
    if (!this.starting) return;
    this.starting = false;
    this.scheduleExpiry();
  }

  submitPrediction(playerId: string, questionId: string, team: TeamCode): ActionResult {
    if (this.status !== "live" || !this.active || this.active.id !== questionId)
      return { ok: false, error: "That question is closed." };
    if (!this.players.has(playerId)) return { ok: false, error: "You are not in this session." };
    const answers = this.predictions.get(questionId)!;
    if (answers.has(playerId)) return { ok: false, error: "You already locked in." };

    answers.set(playerId, { team, odds: this.odds[team] });
    this.notify(this);
    return { ok: true };
  }

  markDisconnected(playerId: string) {
    const player = this.players.get(playerId);
    if (!player) return;
    player.connected = false;
    this.notify(this);
  }

  stop() {
    this.matchFeed?.stop();
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
  }

  recordPayout(signature: string) {
    if (this.status !== "finished" || this.payoutSignature) return;
    this.payoutSignature = signature;
    this.notify(this);
  }

  recordRefund(signature: string | null) {
    if (this.status !== "expired" || this.refundComplete) return;
    this.refundComplete = true;
    this.refundSignature = signature;
    this.notify(this);
  }

  private expireUnstarted() {
    if (this.status !== "lobby" || this.starting) return;
    this.status = "expired";
    this.expiryTimer = null;
    this.notify(this);
  }

  private scheduleExpiry() {
    if (this.status !== "lobby" || this.fixture.status !== "upcoming" || !this.fixture.startsAt)
      return;
    const remaining = this.fixture.startsAt + KICKOFF_GRACE_MS - Date.now();
    if (remaining <= 0) return this.expireUnstarted();
    // JavaScript timers clamp larger delays; reschedule distant fixtures in chunks.
    this.expiryTimer = setTimeout(() => this.scheduleExpiry(), Math.min(remaining, 2_147_000_000));
  }

  // ---- match loop -------------------------------------------------------

  private handleMinute(minute: number) {
    this.minute = minute;
    if (this.status !== "live") return;

    // Lock the active question once its answer window closes.
    if (this.active && minute >= this.active.lockAtMinute) {
      this.pending.push(this.active);
      this.active = null;
    }

    // Pop a new question at the randomly scheduled minute.
    if (!this.active && minute >= this.nextOpenMinute && minute <= LAST_QUESTION_MINUTE) {
      this.openQuestion(minute);
    }

    this.notify(this);
  }

  private handleFeedEvent(event: FeedEvent) {
    switch (event.kind) {
      case "ODDS":
        this.odds = event.goalOdds;
        break;
      case "SCORE_SNAPSHOT":
        this.score = { ...event.score };
        break;
      case "GOAL":
        this.score[event.team] += 1;
        this.feed.push(event);
        this.resolveMatching(event);
        break;
      case "CARD":
      case "CORNER":
        this.feed.push(event);
        this.resolveMatching(event);
        break;
      case "FULL_TIME":
        this.feed.push(event);
        this.voidAll(event.minute);
        this.finish();
        break;
      default:
        this.feed.push(event);
    }
    this.notify(this);
  }

  // ---- question engine --------------------------------------------------

  private openQuestion(minute: number) {
    // Random type — but a type with an unresolved question stays off the board,
    // and we avoid repeating the previous type when there's a choice.
    const openTypes = new Set(this.pending.map((q) => q.type));
    let pool = QUESTION_TYPES.filter((t) => !openTypes.has(t));
    if (pool.length === 0) {
      this.nextOpenMinute = minute + 3; // everything pending — try again shortly
      return;
    }
    if (pool.length > 1 && this.lastType) pool = pool.filter((t) => t !== this.lastType);
    const type = pool[Math.floor(Math.random() * pool.length)];
    this.lastType = type;

    this.questionCount += 1;
    const id = `q${this.questionCount}`;
    this.active = {
      id,
      type,
      text: QUESTION_SPECS[type].text,
      openedAtMinute: minute,
      lockAtMinute: minute + ANSWER_WINDOW,
    };
    this.predictions.set(id, new Map());
    this.nextOpenMinute = minute + QUESTION_GAP();
    this.scheduleBotPick(id);
  }

  private scheduleBotPick(questionId: string) {
    if (this.mode !== "practice" || Math.random() < 0.12) return;
    const bot = [...this.players.values()].find((player) => player.isBot);
    if (!bot) return;
    const delay = 700 + Math.floor(Math.random() * 1_800);
    setTimeout(() => {
      if (this.status !== "live" || this.active?.id !== questionId) return;
      const homeWeight = 1 / this.odds.HOME;
      const awayWeight = 1 / this.odds.AWAY;
      const team: TeamCode =
        Math.random() < homeWeight / (homeWeight + awayWeight) ? "HOME" : "AWAY";
      this.submitPrediction(bot.id, questionId, team);
    }, delay);
  }

  /** Settle every open question (active + pending) that this event answers. */
  private resolveMatching(event: MatchEvent) {
    const settle = (q: QuestionInternal): boolean => {
      const spec = QUESTION_SPECS[q.type];
      const winner = spec.matches(event);
      if (!winner) return false;

      const answers = this.predictions.get(q.id) ?? new Map<string, Prediction>();
      const entries = [...answers.entries()].map(([playerId, prediction]) => {
        const correct = prediction.team === winner;
        const points = !correct
          ? 0
          : spec.usesOdds
            ? Math.round(BASE_POINTS * prediction.odds)
            : FLAT_POINTS;
        if (points > 0) this.players.get(playerId)!.score += points;
        return { playerId, team: prediction.team, points };
      });
      this.results.push({
        questionId: q.id,
        type: q.type,
        text: q.text,
        team: winner,
        headline: spec.headline(event, this.teamName(winner)),
        minute: event.minute,
        entries,
      });
      this.predictions.delete(q.id);
      return true;
    };

    this.pending = this.pending.filter((q) => !settle(q));
    // An event in the same minute the question opened would settle it before
    // anyone could answer — let that question wait for the next occurrence.
    if (this.active && event.minute > this.active.openedAtMinute && settle(this.active)) {
      this.active = null;
    }
  }

  private voidAll(minute: number) {
    const open = [...this.pending, ...(this.active ? [this.active] : [])];
    for (const q of open) {
      this.results.push({
        questionId: q.id,
        type: q.type,
        text: q.text,
        team: null,
        headline: "Full time — question voided.",
        minute,
        entries: [],
      });
      this.predictions.delete(q.id);
    }
    this.pending = [];
    this.active = null;
  }

  private finish() {
    this.status = "finished";
    const topScore = Math.max(...[...this.players.values()].map((p) => p.score));
    this.noContest = topScore === 0;
    this.winners = [...this.players.values()]
      .filter((p) => p.score === topScore)
      .map((p) => p.id);
    this.matchFeed?.stop();
  }

  private teamName(team: TeamCode): string {
    return team === "HOME" ? this.fixture.home.name : this.fixture.away.name;
  }

  toState(): SessionState {
    const activeState: ActiveQuestion | null = this.active ? { ...this.active } : null;
    const pendingState: PendingQuestion[] = this.pending.map((q) => ({
      id: q.id,
      type: q.type,
      text: q.text,
    }));
    return {
      code: this.code,
      mode: this.mode,
      fixture: this.fixture,
      escrowId: this.escrowId,
      status: this.status,
      hostId: this.hostId,
      players: [...this.players.values()].map((p) => ({ ...p })),
      minute: this.minute,
      score: { ...this.score },
      odds: { ...this.odds },
      feed: [...this.feed],
      question: activeState,
      pendingQuestions: pendingState,
      predictions: Object.fromEntries(
        [...this.predictions.entries()].map(([qid, answers]) => [
          qid,
          Object.fromEntries([...answers.entries()].map(([pid, p]) => [pid, p.team])),
        ]),
      ),
      lastResult: this.results.length > 0 ? this.results[this.results.length - 1] : null,
      results: [...this.results],
      winners: this.winners,
      noContest: this.noContest,
      payoutSignature: this.payoutSignature,
      refundComplete: this.refundComplete,
      refundSignature: this.refundSignature,
    };
  }
}

function formatTimeUntil(timestamp: number): string {
  const totalMinutes = Math.max(1, Math.ceil((timestamp - Date.now()) / 60_000));
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [
    days ? `${days}d` : "",
    hours ? `${hours}h` : "",
    minutes && !days ? `${minutes}m` : "",
  ].filter(Boolean);
  return `in ${parts.join(" ")}`;
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export class SessionStore {
  private sessions = new Map<string, Session>();

  constructor(private readonly notify: (session: Session) => void) {}

  create(fixtureId: number, mode: SessionMode): Session | null {
    const fixture = DEMO_FIXTURES.find((candidate) => candidate.id === fixtureId);
    if (!fixture || (mode === "practice" && fixture.status !== "historical")) return null;
    let code: string;
    do {
      code = Array.from(
        { length: 4 },
        () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)],
      ).join("");
    } while (this.sessions.has(code));
    // The display code can eventually be reused; the escrow PDA seed cannot.
    const escrowId = randomBytes(32).toString("hex");
    const session = new Session(code, escrowId, fixture, mode, this.notify);
    this.sessions.set(code, session);
    return session;
  }

  get(code: string): Session | undefined {
    return this.sessions.get(code.trim().toUpperCase());
  }
}
