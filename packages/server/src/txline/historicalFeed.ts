import type { FeedEvent, NextGoalOdds, TeamCode } from "@nextgoal/shared";
import type { FeedHandlers, MatchFeed } from "../feed";
import { SimulatedFeed } from "../simulatedFeed";
import { MS_PER_MINUTE } from "../fixture";
import { apiGet, dataHeaders, ensureAuth, type TxLineAuth } from "./auth";
import { networkConfig } from "./config";
import { mapNextGoalOdds, type ParticipantTeams, type Rec } from "./feed";

// Replays a finished match from real TxLINE data (FEED=txline-history).
//
// /scores/historical/{fixtureId} returns the full recorded soccer feed as SSE
// lines: kickoff, goals (with Stats key 1/2 = participant total goals, and a
// follow-up record carrying Data.PlayerId), cards, halftime_finalised,
// game_finalised, plus lineups with player names. We map it onto FeedEvents and
// replay through SimulatedFeed pacing. Real in-running odds come from
// /odds/snapshot/{fixtureId}?asOf=<wall clock ts> sampled across the match.

const ODDS_SAMPLE_MINUTES = 5;

export class TxLineHistoricalFeed implements MatchFeed {
  private inner: SimulatedFeed | null = null;
  private stopped = false;

  constructor(private readonly fixtureId: number) {}

  start(handlers: FeedHandlers) {
    this.prepare()
      .then((events) => {
        if (this.stopped) return;
        console.log(`[txline] replaying fixture ${this.fixtureId}: ${events.length} feed events`);
        this.inner = new SimulatedFeed(events, MS_PER_MINUTE);
        this.inner.start(handlers);
      })
      .catch((err) => console.error("[txline] historical feed failed:", err));
  }

  stop() {
    this.stopped = true;
    this.inner?.stop();
  }

  private async prepare(): Promise<FeedEvent[]> {
    const auth = await ensureAuth();
    const records = await fetchHistoricalRecords(auth, this.fixtureId);
    if (records.length === 0) {
      throw new Error(`No historical data for fixture ${this.fixtureId}`);
    }

    const teams = resolveTeams(records);
    const players = buildPlayerNames(records);
    const events: FeedEvent[] = [];

    let kickoffSeen = false;
    let halfTimeSeen = false;
    let goals: Record<"p1" | "p2", number> = { p1: 0, p2: 0 };
    let minute = 0;
    let firstKickoffTs = 0;
    let secondHalfKickoffTs = 0;

    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      const clock = r.Clock?.Seconds;
      if (typeof clock === "number") minute = Math.floor(clock / 60);

      // Goals are detected by diffing the score stats (key 1/2 = participant
      // total goals) on every record — regular goals arrive via "goal" bursts,
      // but penalties increment the score on "penalty_outcome" records instead.
      const p1 = numberOr(r.Stats?.["1"], goals.p1);
      const p2 = numberOr(r.Stats?.["2"], goals.p2);
      if (p1 > goals.p1 || p2 > goals.p2) {
        const team = p1 > goals.p1 ? teams.p1 : teams.p2;
        events.push({
          kind: "GOAL",
          minute,
          team,
          scorer: findScorer(records, i, clock, players),
        });
      }
      goals = { p1, p2 };

      switch (r.Action) {
        case "kickoff": {
          if (!kickoffSeen) {
            kickoffSeen = true;
            firstKickoffTs = r.Ts;
            events.push({ kind: "KICKOFF", minute: 0 });
          } else if (halfTimeSeen && !secondHalfKickoffTs && r.Clock?.Running) {
            secondHalfKickoffTs = r.Ts;
          }
          break;
        }
        case "halftime_finalised": {
          if (!halfTimeSeen) {
            halfTimeSeen = true;
            events.push({ kind: "HALF_TIME", minute: 45 });
          }
          break;
        }
        case "game_finalised": {
          events.push({ kind: "FULL_TIME", minute: Math.max(minute, 90) });
          break;
        }
        case "yellow_card":
        case "red_card": {
          const card = r.Action === "red_card" ? "Red card" : "Yellow card";
          events.push({ kind: "COMMENTARY", minute, text: `${card} — ${sideName(r, teams)}.` });
          break;
        }
        case "penalty": {
          events.push({
            kind: "COMMENTARY",
            minute,
            text: `Penalty to ${sideName(r, teams)}!`,
          });
          break;
        }
        case "var": {
          events.push({ kind: "COMMENTARY", minute, text: "VAR check under way…" });
          break;
        }
        case "shot": {
          const outcome = r.Data?.Outcome;
          if (outcome === "OnTarget" || outcome === "Woodwork") {
            const how = outcome === "Woodwork" ? "rattles the woodwork" : "forces a save";
            events.push({
              kind: "COMMENTARY",
              minute,
              text: `${sideName(r, teams)} ${how}.`,
            });
          }
          break;
        }
      }
    }

    if (!events.some((e) => e.kind === "FULL_TIME")) {
      events.push({ kind: "FULL_TIME", minute: Math.max(minute, 90) });
    }

    events.push(...(await this.fetchOddsTimeline(auth, teams, firstKickoffTs, secondHalfKickoffTs)));
    return events;
  }

  /** Samples real in-running odds snapshots across the match via asOf timestamps. */
  private async fetchOddsTimeline(
    auth: TxLineAuth,
    teams: ParticipantTeams,
    firstKickoffTs: number,
    secondHalfKickoffTs: number,
  ): Promise<FeedEvent[]> {
    if (!firstKickoffTs) return [];
    const minutes: number[] = [];
    for (let m = 0; m <= 95; m += ODDS_SAMPLE_MINUTES) minutes.push(m);

    const samples = await Promise.all(
      minutes.map(async (m): Promise<FeedEvent | null> => {
        const asOf =
          m < 45 || !secondHalfKickoffTs
            ? firstKickoffTs + m * 60_000
            : secondHalfKickoffTs + (m - 45) * 60_000;
        try {
          const snapshot = await apiGet<Rec[]>(
            auth,
            `/odds/snapshot/${this.fixtureId}?asOf=${asOf}`,
          );
          for (const record of snapshot ?? []) {
            const odds = mapNextGoalOdds(record, teams);
            if (odds) return { kind: "ODDS", minute: m, nextGoal: odds };
          }
        } catch {
          // A missing interval just means no odds tick at that minute.
        }
        return null;
      }),
    );
    const events = samples.filter((e): e is FeedEvent => e !== null);
    console.log(`[txline] sampled ${events.length} historical odds points`);
    return events;
  }
}

async function fetchHistoricalRecords(auth: TxLineAuth, fixtureId: number): Promise<Rec[]> {
  const { apiBaseUrl } = networkConfig();
  const res = await fetch(`${apiBaseUrl}/scores/historical/${fixtureId}`, {
    headers: dataHeaders(auth),
  });
  if (!res.ok) throw new Error(`historical fetch failed: ${res.status}`);
  const text = await res.text();
  return text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => {
      try {
        return JSON.parse(line.slice(5).trim()) as Rec;
      } catch {
        return null;
      }
    })
    .filter((r): r is Rec => r !== null);
}

/** Map participant slots to app teams by lineup team names, falling back to env. */
function resolveTeams(records: Rec[]): ParticipantTeams {
  const fallback: ParticipantTeams = {
    p1: (process.env.TXLINE_P1_TEAM ?? "ENG") as TeamCode,
    p2: (process.env.TXLINE_P2_TEAM ?? "MEX") as TeamCode,
  };
  const lineups = records.find((r) => r.Action === "lineups" && Array.isArray(r.Lineups));
  if (!lineups) return fallback;
  const p1Id = lineups.Participant1Id;
  const teams = { ...fallback };
  for (const side of lineups.Lineups as Rec[]) {
    const name = String(side.preferredName ?? "").toLowerCase();
    const code: TeamCode | null = name.includes("england")
      ? "ENG"
      : name.includes("mexico")
        ? "MEX"
        : null;
    if (!code) continue;
    if (side.normativeId === p1Id) teams.p1 = code;
    else teams.p2 = code;
  }
  if (teams.p1 === teams.p2) return fallback;
  return teams;
}

/** playerId (normativeId) -> display name, from the lineups records. */
function buildPlayerNames(records: Rec[]): Map<number, string> {
  const names = new Map<number, string>();
  for (const r of records) {
    if (!Array.isArray(r.Lineups)) continue;
    for (const side of r.Lineups as Rec[]) {
      for (const entry of side.lineups ?? []) {
        const player = entry.player;
        if (player?.normativeId && player.preferredName) {
          names.set(Number(player.normativeId), flipName(String(player.preferredName)));
        }
      }
    }
  }
  return names;
}

/**
 * Scorer attribution: near the record that increments the score sits a
 * goal/penalty record carrying Data.PlayerId. Unrelated records (possession
 * ticks) interleave the burst, so scan a window with a clock tolerance.
 */
function findScorer(
  records: Rec[],
  from: number,
  clock: number | undefined,
  players: Map<number, string>,
): string {
  for (let j = Math.max(0, from - 3); j < Math.min(from + 15, records.length); j++) {
    const r = records[j];
    if (!["goal", "penalty_outcome", "penalty"].includes(r.Action)) continue;
    const rClock = r.Clock?.Seconds;
    if (clock !== undefined && rClock !== undefined && Math.abs(rClock - clock) > 90) continue;
    const playerId = r.Data?.PlayerId;
    if (playerId && players.has(Number(playerId))) return players.get(Number(playerId))!;
  }
  return "";
}

/** "Kane, Harry" -> "Harry Kane" */
function flipName(name: string): string {
  const [last, first] = name.split(",").map((s) => s.trim());
  return first ? `${first} ${last}` : name;
}

function sideName(record: Rec, teams: ParticipantTeams): string {
  const team = record.Participant === 1 ? teams.p1 : teams.p2;
  return team === "ENG" ? "England" : "Mexico";
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
