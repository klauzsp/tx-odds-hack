import type { FeedEvent, NextGoalOdds } from "@nextgoal/shared";

// England vs Mexico replay fixture, shaped like the TxLINE live feed: match
// events interleaved with next-goal odds ticks. Used when FEED=sim (default);
// FEED=txline consumes the real TxLINE SSE streams instead (see txline/feed.ts).

/** Real-time milliseconds per match minute (90 minutes total). */
export const MS_PER_MINUTE = Number(process.env.MS_PER_MINUTE ?? 800);

export const INITIAL_ODDS: NextGoalOdds = { ENG: 1.72, MEX: 2.9 };

export const FIXTURE: FeedEvent[] = [
  { kind: "KICKOFF", minute: 0 },
  { kind: "ODDS", minute: 0, nextGoal: INITIAL_ODDS },
  { kind: "COMMENTARY", minute: 6, text: "Bellingham drives through midfield and wins England an early corner." },
  { kind: "CORNER", minute: 7, team: "ENG" },
  { kind: "COMMENTARY", minute: 13, text: "Santiago Giménez heads narrowly wide from a Mexico free-kick." },
  { kind: "ODDS", minute: 14, nextGoal: { ENG: 1.85, MEX: 2.6 } },
  { kind: "CARD", minute: 17, team: "MEX", card: "yellow", player: "Edson Álvarez" },
  { kind: "COMMENTARY", minute: 20, text: "England knocking on the door — Saka's cross flashes across the six-yard box." },
  { kind: "CORNER", minute: 21, team: "ENG" },
  { kind: "GOAL", minute: 24, team: "ENG", scorer: "Harry Kane" },
  { kind: "ODDS", minute: 25, nextGoal: { ENG: 1.95, MEX: 2.45 } },
  { kind: "CORNER", minute: 30, team: "MEX" },
  { kind: "COMMENTARY", minute: 33, text: "Mexico respond — high press forcing errors in the England back line." },
  { kind: "GOAL", minute: 39, team: "MEX", scorer: "Santiago Giménez" },
  { kind: "ODDS", minute: 40, nextGoal: { ENG: 1.88, MEX: 2.55 } },
  { kind: "CARD", minute: 43, team: "ENG", card: "yellow", player: "Declan Rice" },
  { kind: "HALF_TIME", minute: 45 },
  { kind: "COMMENTARY", minute: 46, text: "Second half under way at the Estadio Azteca. All square at 1-1." },
  { kind: "CORNER", minute: 51, team: "ENG" },
  { kind: "COMMENTARY", minute: 55, text: "Saka twice beats his man — Mexico living dangerously down their left." },
  { kind: "ODDS", minute: 56, nextGoal: { ENG: 1.7, MEX: 2.95 } },
  { kind: "CARD", minute: 60, team: "MEX", card: "yellow", player: "Johan Vásquez" },
  { kind: "CORNER", minute: 64, team: "MEX" },
  { kind: "GOAL", minute: 67, team: "ENG", scorer: "Jude Bellingham" },
  { kind: "ODDS", minute: 68, nextGoal: { ENG: 2.05, MEX: 2.35 } },
  { kind: "CORNER", minute: 73, team: "ENG" },
  { kind: "COMMENTARY", minute: 78, text: "Mexico throw everyone forward in search of an equaliser." },
  { kind: "CARD", minute: 81, team: "MEX", card: "yellow", player: "César Montes" },
  { kind: "GOAL", minute: 85, team: "ENG", scorer: "Bukayo Saka" },
  { kind: "ODDS", minute: 86, nextGoal: { ENG: 2.6, MEX: 2.0 } },
  { kind: "CORNER", minute: 88, team: "MEX" },
  { kind: "FULL_TIME", minute: 90 },
];
