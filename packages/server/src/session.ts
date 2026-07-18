import { randomUUID } from "node:crypto";
import type {
  ActiveQuestion,
  FeedEvent,
  NextGoalOdds,
  QuestionResult,
  SessionState,
  SessionStatus,
  TeamCode,
} from "@nextgoal/shared";
import { MatchEngine } from "./matchEngine";
import { FIXTURE, INITIAL_ODDS, MS_PER_MINUTE } from "./fixture";

const MAX_PLAYERS = 2;
const BASE_POINTS = 100;

interface PlayerInternal {
  id: string;
  name: string;
  score: number;
  connected: boolean;
}

interface Prediction {
  team: TeamCode;
  /** Odds snapshot when the player locked in — determines their payout. */
  odds: number;
}

type JoinResult = { ok: true; playerId: string } | { ok: false; error: string };
type ActionResult = { ok: true } | { ok: false; error: string };

export class Session {
  status: SessionStatus = "lobby";
  hostId = "";

  private players = new Map<string, PlayerInternal>();
  private minute = 0;
  private score: Record<TeamCode, number> = { ENG: 0, MEX: 0 };
  private odds: NextGoalOdds = { ...INITIAL_ODDS };
  private feed: SessionState["feed"] = [];
  private question: ActiveQuestion | null = null;
  private predictions = new Map<string, Prediction>();
  private lastResult: QuestionResult | null = null;
  private winners: string[] | null = null;
  private engine: MatchEngine | null = null;
  private questionCount = 0;

  constructor(
    readonly code: string,
    private readonly notify: (session: Session) => void,
  ) {}

  join(rawName: string): JoinResult {
    const name = rawName.trim();
    if (!name) return { ok: false, error: "Enter a name first." };

    // Same name reclaims its seat, so a dropped player can rejoin mid-match.
    const existing = [...this.players.values()].find(
      (p) => p.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
      existing.connected = true;
      this.notify(this);
      return { ok: true, playerId: existing.id };
    }

    if (this.status !== "lobby") return { ok: false, error: "That match has already kicked off." };
    if (this.players.size >= MAX_PLAYERS)
      return { ok: false, error: `Session is full (${MAX_PLAYERS} players).` };

    const id = randomUUID();
    this.players.set(id, { id, name, score: 0, connected: true });
    if (this.players.size === 1) this.hostId = id;
    this.notify(this);
    return { ok: true, playerId: id };
  }

  start(playerId: string): ActionResult {
    if (this.status !== "lobby") return { ok: false, error: "Match already started." };
    if (playerId !== this.hostId) return { ok: false, error: "Only the host can kick off." };
    if (this.players.size < MAX_PLAYERS)
      return { ok: false, error: "Waiting for your friend to join." };

    this.status = "live";
    this.openQuestion();
    this.engine = new MatchEngine(FIXTURE, MS_PER_MINUTE, {
      onMinute: (minute) => {
        this.minute = minute;
        this.notify(this);
      },
      onEvent: (event) => this.handleFeedEvent(event),
    });
    this.engine.start();
    return { ok: true };
  }

  submitPrediction(playerId: string, questionId: string, team: TeamCode): ActionResult {
    if (this.status !== "live" || !this.question || this.question.id !== questionId)
      return { ok: false, error: "That question is closed." };
    if (!this.players.has(playerId)) return { ok: false, error: "You are not in this session." };
    if (this.predictions.has(playerId)) return { ok: false, error: "You already locked in." };

    this.predictions.set(playerId, { team, odds: this.odds[team] });
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
    this.engine?.stop();
  }

  private handleFeedEvent(event: FeedEvent) {
    switch (event.kind) {
      case "ODDS":
        this.odds = event.nextGoal;
        break;
      case "GOAL":
        this.score[event.team] += 1;
        this.feed.push(event);
        this.resolveQuestion(event.team, event.scorer, event.minute);
        this.openQuestion();
        break;
      case "FULL_TIME":
        this.feed.push(event);
        this.voidQuestion(event.minute);
        this.finish();
        break;
      default:
        this.feed.push(event);
    }
    this.notify(this);
  }

  private openQuestion() {
    this.questionCount += 1;
    this.question = {
      id: `q${this.questionCount}`,
      text: "Who scores the next goal?",
      openedAtMinute: this.minute,
    };
    this.predictions.clear();
  }

  private resolveQuestion(team: TeamCode, scorer: string, minute: number) {
    if (!this.question) return;
    const entries = [...this.predictions.entries()].map(([playerId, prediction]) => {
      const points =
        prediction.team === team ? Math.round(BASE_POINTS * prediction.odds) : 0;
      if (points > 0) this.players.get(playerId)!.score += points;
      return { playerId, team: prediction.team, points };
    });
    this.lastResult = { questionId: this.question.id, team, scorer, minute, entries };
    this.question = null;
  }

  private voidQuestion(minute: number) {
    if (!this.question) return;
    this.lastResult = {
      questionId: this.question.id,
      team: null,
      scorer: null,
      minute,
      entries: [],
    };
    this.question = null;
    this.predictions.clear();
  }

  private finish() {
    this.status = "finished";
    const topScore = Math.max(...[...this.players.values()].map((p) => p.score));
    this.winners = [...this.players.values()]
      .filter((p) => p.score === topScore)
      .map((p) => p.id);
    this.engine?.stop();
  }

  toState(): SessionState {
    return {
      code: this.code,
      status: this.status,
      hostId: this.hostId,
      players: [...this.players.values()].map((p) => ({ ...p })),
      minute: this.minute,
      score: { ...this.score },
      odds: { ...this.odds },
      feed: [...this.feed],
      question: this.question,
      predictions: Object.fromEntries(
        [...this.predictions.entries()].map(([id, p]) => [id, p.team]),
      ),
      lastResult: this.lastResult,
      winners: this.winners,
    };
  }
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export class SessionStore {
  private sessions = new Map<string, Session>();

  constructor(private readonly notify: (session: Session) => void) {}

  create(): Session {
    let code: string;
    do {
      code = Array.from(
        { length: 4 },
        () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)],
      ).join("");
    } while (this.sessions.has(code));
    const session = new Session(code, this.notify);
    this.sessions.set(code, session);
    return session;
  }

  get(code: string): Session | undefined {
    return this.sessions.get(code.trim().toUpperCase());
  }
}
