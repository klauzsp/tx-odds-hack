// Shared contract between the game server and the Next.js client.

/** Stable prediction slots; display names come from the session fixture. */
export type TeamCode = "HOME" | "AWAY";

export const TEAM_CODES: TeamCode[] = ["HOME", "AWAY"];

export interface FixtureTeam {
  id: number;
  name: string;
  flag: string;
}

export interface GameFixture {
  id: number;
  home: FixtureTeam;
  away: FixtureTeam;
  status: "historical" | "upcoming";
  /** Set while a finished fixture is waiting for its TXODDS replay records. */
  replayStatus?: "processing";
  startsAt?: number;
  stage?: string;
}

/** Curated, verified TxLINE replays for the hackathon selector. */
export const DEMO_FIXTURES: GameFixture[] = [
  {
    id: 18192996,
    status: "historical",
    home: { id: 2545, name: "Mexico", flag: "🇲🇽" },
    away: { id: 1888, name: "England", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  },
  {
    id: 18193785,
    status: "historical",
    home: { id: 3220, name: "USA", flag: "🇺🇸" },
    away: { id: 1575, name: "Belgium", flag: "🇧🇪" },
  },
  {
    id: 18198205,
    status: "historical",
    home: { id: 2802, name: "Portugal", flag: "🇵🇹" },
    away: { id: 3021, name: "Spain", flag: "🇪🇸" },
  },
  {
    id: 18209181,
    status: "historical",
    home: { id: 1999, name: "France", flag: "🇫🇷" },
    away: { id: 2530, name: "Morocco", flag: "🇲🇦" },
  },
  {
    id: 18257865,
    status: "historical",
    replayStatus: "processing",
    startsAt: 1_784_408_400_000,
    stage: "Third-place play-off",
    home: { id: 1999, name: "France", flag: "🇫🇷" },
    away: { id: 1888, name: "England", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  },
  {
    id: 18257739,
    status: "upcoming",
    startsAt: 1_784_487_600_000,
    stage: "Final",
    home: { id: 3021, name: "Spain", flag: "🇪🇸" },
    away: { id: 1489, name: "Argentina", flag: "🇦🇷" },
  },
];

/** 0.1 SOL per player on devnet. The escrow stores this value on initialization. */
export const ENTRY_LAMPORTS = 100_000_000;

/** Upcoming sessions accept escrow deposits only during the final 15 minutes before kickoff. */
export const ENTRY_WINDOW_MS = 15 * 60 * 1_000;

/** An unfunded or partially funded upcoming session expires five minutes after kickoff. */
export const KICKOFF_GRACE_MS = 5 * 60 * 1_000;

/** Decimal odds for "which team scores the next goal". */
export type GoalOdds = Record<TeamCode, number>;

export type MatchEvent =
  | { kind: "KICKOFF"; minute: number }
  | { kind: "COMMENTARY"; minute: number; text: string }
  | { kind: "GOAL"; minute: number; team: TeamCode; scorer: string }
  | { kind: "CARD"; minute: number; team: TeamCode; card: "yellow" | "red"; player: string }
  | { kind: "CORNER"; minute: number; team: TeamCode }
  | { kind: "HALF_TIME"; minute: number }
  | { kind: "FULL_TIME"; minute: number };

/** Raw feed event — MatchEvents plus odds ticks (mirrors what a TXODDS live feed delivers). */
export type FeedEvent =
  | MatchEvent
  | { kind: "ODDS"; minute: number; goalOdds: GoalOdds }
  | { kind: "SCORE_SNAPSHOT"; minute: number; score: Record<TeamCode, number> };

export type SessionStatus = "lobby" | "live" | "finished" | "expired";
export type SessionMode = "competitive" | "practice";

export interface PlayerPublic {
  id: string;
  name: string;
  /** Base58 Solana address that owns this seat and can receive a payout. */
  wallet: string;
  score: number;
  connected: boolean;
  isBot: boolean;
}

export type QuestionType = "NEXT_GOAL" | "NEXT_CARD" | "NEXT_CORNER";

/** A question currently accepting answers; it locks at lockAtMinute. */
export interface ActiveQuestion {
  id: string;
  type: QuestionType;
  text: string;
  openedAtMinute: number;
  lockAtMinute: number;
}

/** A locked question waiting for its event (e.g. the next card) to happen. */
export interface PendingQuestion {
  id: string;
  type: QuestionType;
  text: string;
}

/** One row per player who answered; points is 0 for wrong picks. */
export interface QuestionResultEntry {
  playerId: string;
  team: TeamCode;
  points: number;
  /** TXODDS price captured when this prediction was submitted. */
  oddsAtPick: number;
}

export interface QuestionResult {
  questionId: string;
  type: QuestionType;
  text: string;
  /** null means the match ended before the event happened — question voided. */
  team: TeamCode | null;
  /** Display line, e.g. "⚽ Harry Kane — England (59')". */
  headline: string;
  minute: number;
  entries: QuestionResultEntry[];
}

export interface SessionState {
  code: string;
  mode: SessionMode;
  fixture: GameFixture;
  /** Unique 32-byte hex identifier used as the escrow PDA seed. */
  escrowId: string;
  status: SessionStatus;
  hostId: string;
  players: PlayerPublic[];
  minute: number;
  score: Record<TeamCode, number>;
  odds: GoalOdds;
  feed: MatchEvent[];
  question: ActiveQuestion | null;
  pendingQuestions: PendingQuestion[];
  /** questionId -> playerId -> team they locked in. */
  predictions: Record<string, Record<string, TeamCode>>;
  lastResult: QuestionResult | null;
  /** All resolved/voided questions, oldest first. */
  results: QuestionResult[];
  winners: string[] | null;
  /** True when every player finished on zero points and all entries are returned. */
  noContest: boolean;
  /** Devnet transaction signature after the application settles the escrow. */
  payoutSignature: string | null;
  /** Devnet transaction that locked the funded pool at kickoff. */
  lockSignature: string | null;
  /** Feed preparation failure shown in the lobby so kickoff can be retried. */
  feedError: string | null;
  /** True once an expired session has been checked and any deposits returned. */
  refundComplete: boolean;
  /** Devnet refund transaction, or null when the expired session held no deposits. */
  refundSignature: string | null;
}

export type Ack = { ok: true } | { ok: false; error: string };

export type JoinAck =
  | { ok: true; playerId: string; code: string; state: SessionState }
  | { ok: false; error: string };

export interface ServerToClientEvents {
  state: (state: SessionState) => void;
}

export interface ClientToServerEvents {
  "session:create": (
    payload: { name: string; wallet: string; fixtureId: number; mode: SessionMode },
    cb: (ack: JoinAck) => void,
  ) => void;
  "session:join": (
    payload: { code: string; name: string; wallet: string },
    cb: (ack: JoinAck) => void,
  ) => void;
  "session:leave": (cb: (ack: Ack) => void) => void;
  "match:start": (cb: (ack: Ack) => void) => void;
  "prediction:submit": (
    payload: { questionId: string; team: TeamCode },
    cb: (ack: Ack) => void,
  ) => void;
}
