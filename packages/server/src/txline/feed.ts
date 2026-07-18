import type { NextGoalOdds, TeamCode } from "@nextgoal/shared";
import type { FeedHandlers, MatchFeed } from "../feed";
import { apiGet, ensureAuth, type TxLineAuth } from "./auth";
import { openStream } from "./stream";
import type { EventSource } from "eventsource";

// Live TxLINE feed for one fixture.
//
// Goal detection uses the documented stat encoding (soccer feed docs):
//   stat key 1 = participant 1 total goals, key 2 = participant 2 total goals.
// We diff those totals on every scores message and emit a GOAL when one increases.
//
// ⚠️ Payload field names below are defensive guesses over several plausible
// spellings — the docs don't publish full JSON examples. Before the demo, run
// `pnpm txline:probe <fixtureId>` against a live match, check the logged
// "unmapped" lines, and tighten `extractRecords`/`readStat` to the real shape.

/** Which app team each TxLINE participant slot maps to (participant 1 is the home side). */
const P1_TEAM = (process.env.TXLINE_P1_TEAM ?? "ENG") as TeamCode;
const P2_TEAM = (process.env.TXLINE_P2_TEAM ?? "MEX") as TeamCode;

const GOAL_STAT_KEYS: Record<TeamCode, number> = { [P1_TEAM]: 1, [P2_TEAM]: 2 } as Record<
  TeamCode,
  number
>;

/** Maps TxLINE participant slots (1 = home) to app team codes. */
export interface ParticipantTeams {
  p1: TeamCode;
  p2: TeamCode;
}

export class TxLineFeed implements MatchFeed {
  private sources: EventSource[] = [];
  private handlers: FeedHandlers | null = null;
  private goals: Record<TeamCode, number> = { ENG: 0, MEX: 0 };
  private minute = 0;
  private kickedOff = false;
  private stopped = false;

  constructor(private readonly fixtureId: number) {}

  start(handlers: FeedHandlers) {
    this.handlers = handlers;
    this.run().catch((err) => console.error("[txline] feed failed to start:", err));
  }

  stop() {
    this.stopped = true;
    for (const source of this.sources) source.close();
    this.sources = [];
  }

  private async run() {
    const auth = await ensureAuth();
    await this.seedFromSnapshot(auth);
    if (this.stopped) return;

    this.sources.push(
      openStream("/scores/stream", auth, (raw) => this.onScores(raw), "scores"),
      openStream("/odds/stream", auth, (raw) => this.onOdds(raw), "odds"),
    );
  }

  /** Prime goal totals from the snapshot so a mid-match join doesn't replay old goals. */
  private async seedFromSnapshot(auth: TxLineAuth) {
    try {
      const snapshot = await apiGet<unknown>(auth, `/scores/snapshot/${this.fixtureId}`);
      for (const record of asRecords(snapshot)) {
        if (!this.isOurFixture(record)) continue;
        for (const team of [P1_TEAM, P2_TEAM]) {
          const total = readStat(record, GOAL_STAT_KEYS[team]);
          if (total !== null) this.goals[team] = total;
        }
        this.readMinute(record);
      }
      console.log(`[txline] seeded fixture ${this.fixtureId}: score`, this.goals);
    } catch (err) {
      console.warn("[txline] no scores snapshot yet (match may not have started):", err);
    }
  }

  private onScores(raw: string) {
    const records = parseRecords(raw);
    for (const record of records) {
      if (!this.isOurFixture(record)) continue;
      this.readMinute(record);

      if (!this.kickedOff) {
        this.kickedOff = true;
        this.handlers?.onEvent({ kind: "KICKOFF", minute: this.minute });
      }

      for (const team of [P1_TEAM, P2_TEAM]) {
        const total = readStat(record, GOAL_STAT_KEYS[team]);
        if (total !== null && total > this.goals[team]) {
          this.goals[team] = total;
          this.handlers?.onEvent({ kind: "GOAL", minute: this.minute, team, scorer: "" });
        }
      }

      const phase = readPhase(record);
      if (phase === "HALF_TIME") this.handlers?.onEvent({ kind: "HALF_TIME", minute: this.minute });
      if (phase === "FULL_TIME") {
        this.handlers?.onEvent({ kind: "FULL_TIME", minute: this.minute });
        this.stop();
      }
    }
    if (records.length === 0) console.log("[txline] unmapped scores message:", truncate(raw));
  }

  private onOdds(raw: string) {
    for (const record of parseRecords(raw)) {
      if (!this.isOurFixture(record)) continue;
      const odds = mapNextGoalOdds(record, { p1: P1_TEAM, p2: P2_TEAM });
      if (odds) this.handlers?.onEvent({ kind: "ODDS", minute: this.minute, nextGoal: odds });
    }
  }

  private isOurFixture(record: Rec): boolean {
    const id = record.FixtureId ?? record.fixtureId ?? record.fixture_id;
    return Number(id) === this.fixtureId;
  }

  private readMinute(record: Rec) {
    const minute = record.Minute ?? record.minute ?? record.MatchMinute ?? record.matchMinute;
    if (typeof minute === "number" && Number.isFinite(minute)) {
      this.minute = minute;
      this.handlers?.onMinute(minute);
    }
  }
}

export type Rec = Record<string, any>;

function parseRecords(raw: string): Rec[] {
  try {
    return asRecords(JSON.parse(raw));
  } catch {
    return [];
  }
}

function asRecords(parsed: unknown): Rec[] {
  if (Array.isArray(parsed)) return parsed.filter((r) => r && typeof r === "object");
  if (parsed && typeof parsed === "object") return [parsed as Rec];
  return [];
}

/** Reads a stat total by key from the shapes we expect ({Key, Value}[] or keyed object). */
function readStat(record: Rec, key: number): number | null {
  const stats = record.Stats ?? record.stats ?? record.UpdateStats ?? record.updateStats;
  if (Array.isArray(stats)) {
    for (const stat of stats) {
      const statKey = stat.Key ?? stat.key ?? stat.StatKey ?? stat.statKey;
      if (Number(statKey) === key) {
        const value = stat.Value ?? stat.value;
        return typeof value === "number" ? value : Number(value);
      }
    }
    return null;
  }
  if (stats && typeof stats === "object" && key in stats) return Number(stats[key]);
  return null;
}

// Odds messages look like (confirmed live against devnet, 2026-07-18):
//   { FixtureId, Ts, Bookmaker: "TXLineStablePriceDemargined", SuperOddsType,
//     MarketParameters: "line=1.5"|null, MarketPeriod: "half=1"|null,
//     PriceNames: ["part1","draw","part2"], Prices: [2508,2690,4356], Pct: [...] }
// Prices are decimal odds ×1000.
export function mapNextGoalOdds(record: Rec, teams: ParticipantTeams): NextGoalOdds | null {
  const type = String(record.SuperOddsType ?? "");
  const names: unknown = record.PriceNames;
  const prices: unknown = record.Prices;
  if (!Array.isArray(names) || !Array.isArray(prices)) return null;
  const priceOf = (name: string): number | null => {
    const i = names.indexOf(name);
    return i >= 0 && typeof prices[i] === "number" && prices[i] > 0 ? prices[i] / 1000 : null;
  };
  const p1 = priceOf("part1");
  const p2 = priceOf("part2");
  if (!p1 || !p2) return null;

  // Ideal: a dedicated next-goal market, if the feed carries one in-running.
  if (type.includes("NEXTGOAL") || type.includes("NEXT_GOAL")) {
    return { [teams.p1]: round2(p1), [teams.p2]: round2(p2) } as NextGoalOdds;
  }

  // Fallback: approximate from the demargined full-match 1X2 by renormalising
  // the two win probabilities without the draw.
  if (type === "1X2_PARTICIPANT_RESULT" && record.MarketPeriod == null) {
    const q1 = 1 / p1;
    const q2 = 1 / p2;
    return {
      [teams.p1]: round2((q1 + q2) / q1),
      [teams.p2]: round2((q1 + q2) / q2),
    } as NextGoalOdds;
  }
  return null;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function readPhase(record: Rec): "HALF_TIME" | "FULL_TIME" | null {
  const phase = String(record.Phase ?? record.phase ?? record.GamePhase ?? record.gamePhase ?? "");
  const normalized = phase.toLowerCase().replace(/[\s_-]/g, "");
  if (normalized.includes("halftime")) return "HALF_TIME";
  if (["fulltime", "finished", "final", "ended"].some((s) => normalized.includes(s)))
    return "FULL_TIME";
  return null;
}

function truncate(raw: string): string {
  return raw.length > 400 ? `${raw.slice(0, 400)}…` : raw;
}
