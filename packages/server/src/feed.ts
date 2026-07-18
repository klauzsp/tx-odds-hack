import type { FeedEvent } from "@nextgoal/shared";
import { SimulatedFeed } from "./simulatedFeed";
import { FIXTURE, MS_PER_MINUTE } from "./fixture";
import { TxLineFeed } from "./txline/feed";
import { TxLineHistoricalFeed } from "./txline/historicalFeed";

/** Mexico vs England, 2026-07-06 — the default historical replay fixture. */
const DEFAULT_HISTORY_FIXTURE = 18192996;

export interface FeedHandlers {
  onMinute(minute: number): void;
  onEvent(event: FeedEvent): void;
}

/** A source of live match data. Sessions don't care whether it's simulated or TxLINE. */
export interface MatchFeed {
  start(handlers: FeedHandlers): void;
  stop(): void;
}

/**
 * FEED=sim            (default) replays the bundled hand-written fixture
 * FEED=txline-history replays real TxLINE data for a finished match
 * FEED=txline         consumes the live TxLINE SSE streams
 */
export function createFeed(): MatchFeed {
  if (process.env.FEED === "txline") {
    const fixtureId = Number(process.env.TXLINE_FIXTURE_ID);
    if (!fixtureId) {
      throw new Error("FEED=txline requires TXLINE_FIXTURE_ID (find it with `pnpm txline:probe`).");
    }
    return new TxLineFeed(fixtureId);
  }
  if (process.env.FEED === "txline-history") {
    return new TxLineHistoricalFeed(
      Number(process.env.TXLINE_FIXTURE_ID) || DEFAULT_HISTORY_FIXTURE,
    );
  }
  return new SimulatedFeed(FIXTURE, MS_PER_MINUTE);
}
