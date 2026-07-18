import type { FeedEvent, GameFixture } from "@nextgoal/shared";
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
 * The selected fixture is the sole source-of-truth for routing. Completed
 * fixtures replay TxLINE history; upcoming fixtures use TxLINE live streams.
 */
export function createFeed(fixture: GameFixture): MatchFeed {
  if (fixture.status === "historical") return new TxLineHistoricalFeed(fixture);
  return new TxLineFeed(fixture.id);
}
