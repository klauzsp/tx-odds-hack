import type { FeedEvent, NextGoalOdds } from "@nextgoal/shared";

// England vs Mexico replay fixture, shaped like a TXODDS live feed: match events
// interleaved with next-goal odds ticks. To go live, replace this array with a
// subscriber that maps real TXODDS push messages onto FeedEvent and hands them
// to MatchEngine as they arrive.

/** Real-time milliseconds per match minute (90 minutes total). */
export const MS_PER_MINUTE = Number(process.env.MS_PER_MINUTE ?? 800);

export const INITIAL_ODDS: NextGoalOdds = { ENG: 1.72, MEX: 2.9 };

export const FIXTURE: FeedEvent[] = [
  { kind: "KICKOFF", minute: 0 },
  { kind: "ODDS", minute: 0, nextGoal: INITIAL_ODDS },
  { kind: "COMMENTARY", minute: 6, text: "Bellingham drives through midfield and wins England an early corner." },
  { kind: "COMMENTARY", minute: 13, text: "Santiago Giménez heads narrowly wide from a Mexico free-kick." },
  { kind: "ODDS", minute: 14, nextGoal: { ENG: 1.85, MEX: 2.6 } },
  { kind: "COMMENTARY", minute: 20, text: "England knocking on the door — Saka's cross flashes across the six-yard box." },
  { kind: "GOAL", minute: 24, team: "ENG", scorer: "Harry Kane" },
  { kind: "ODDS", minute: 25, nextGoal: { ENG: 1.95, MEX: 2.45 } },
  { kind: "COMMENTARY", minute: 33, text: "Mexico respond — high press forcing errors in the England back line." },
  { kind: "GOAL", minute: 39, team: "MEX", scorer: "Santiago Giménez" },
  { kind: "ODDS", minute: 40, nextGoal: { ENG: 1.88, MEX: 2.55 } },
  { kind: "HALF_TIME", minute: 45 },
  { kind: "COMMENTARY", minute: 46, text: "Second half under way at the Estadio Azteca. All square at 1-1." },
  { kind: "COMMENTARY", minute: 55, text: "Saka twice beats his man — Mexico living dangerously down their left." },
  { kind: "ODDS", minute: 56, nextGoal: { ENG: 1.7, MEX: 2.95 } },
  { kind: "GOAL", minute: 67, team: "ENG", scorer: "Jude Bellingham" },
  { kind: "ODDS", minute: 68, nextGoal: { ENG: 2.05, MEX: 2.35 } },
  { kind: "COMMENTARY", minute: 78, text: "Mexico throw everyone forward in search of an equaliser." },
  { kind: "GOAL", minute: 85, team: "ENG", scorer: "Bukayo Saka" },
  { kind: "ODDS", minute: 86, nextGoal: { ENG: 2.6, MEX: 2.0 } },
  { kind: "FULL_TIME", minute: 90 },
];
