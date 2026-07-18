// Shared contract between the game server and the Next.js client.

export type TeamCode = "ENG" | "MEX";

export const TEAMS: Record<TeamCode, { code: TeamCode; name: string; flag: string }> = {
  ENG: { code: "ENG", name: "England", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  MEX: { code: "MEX", name: "Mexico", flag: "🇲🇽" },
};

export const TEAM_CODES: TeamCode[] = ["ENG", "MEX"];

/** 0.1 SOL per player on devnet. The escrow stores this value on initialization. */
export const ENTRY_LAMPORTS = 100_000_000;

/** Decimal odds for "which team scores the next goal". */
export type NextGoalOdds = Record<TeamCode, number>;

export type MatchEvent =
  | { kind: "KICKOFF"; minute: number }
  | { kind: "COMMENTARY"; minute: number; text: string }
  | { kind: "GOAL"; minute: number; team: TeamCode; scorer: string }
  | { kind: "CARD"; minute: number; team: TeamCode; card: "yellow" | "red"; player: string }
  | { kind: "CORNER"; minute: number; team: TeamCode }
  | { kind: "HALF_TIME"; minute: number }
  | { kind: "FULL_TIME"; minute: number };

/** Raw feed event — MatchEvents plus odds ticks (mirrors what a TXODDS live feed delivers). */
export type FeedEvent = MatchEvent | { kind: "ODDS"; minute: number; nextGoal: NextGoalOdds };

export type SessionStatus = "lobby" | "live" | "finished";

export interface PlayerPublic {
  id: string;
  name: string;
  /** Base58 Solana address that owns this seat and can receive a payout. */
  wallet: string;
  score: number;
  connected: boolean;
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
  /** Unique 32-byte hex identifier used as the escrow PDA seed. */
  escrowId: string;
  status: SessionStatus;
  hostId: string;
  players: PlayerPublic[];
  minute: number;
  score: Record<TeamCode, number>;
  odds: NextGoalOdds;
  feed: MatchEvent[];
  question: ActiveQuestion | null;
  pendingQuestions: PendingQuestion[];
  /** questionId -> playerId -> team they locked in. */
  predictions: Record<string, Record<string, TeamCode>>;
  lastResult: QuestionResult | null;
  /** All resolved/voided questions, oldest first. */
  results: QuestionResult[];
  winners: string[] | null;
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
    payload: { name: string; wallet: string },
    cb: (ack: JoinAck) => void,
  ) => void;
  "session:join": (
    payload: { code: string; name: string; wallet: string },
    cb: (ack: JoinAck) => void,
  ) => void;
  "match:start": (cb: (ack: Ack) => void) => void;
  "prediction:submit": (
    payload: { questionId: string; team: TeamCode },
    cb: (ack: Ack) => void,
  ) => void;
}
