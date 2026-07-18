import type { FeedEvent, GameFixture } from "@nextgoal/shared";
import { SimulatedFeed } from "./simulatedFeed";
import { FIXTURE, MS_PER_MINUTE } from "./fixture";
import { TxLineFeed } from "./txline/feed";
import { TxLineHistoricalFeed } from "./txline/historicalFeed";

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
export function createFeed(fixture: GameFixture): MatchFeed {
  if (process.env.FEED === "txline") {
    return new TxLineFeed(fixture.id);
  }
  if (process.env.FEED === "txline-history") {
    return new TxLineHistoricalFeed(fixture);
  }
  return new SimulatedFeed(FIXTURE, MS_PER_MINUTE);
}
