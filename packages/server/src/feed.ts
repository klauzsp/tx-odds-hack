import type { FeedEvent } from "@nextgoal/shared";
import { SimulatedFeed } from "./simulatedFeed";
import { FIXTURE, MS_PER_MINUTE } from "./fixture";
import { TxLineFeed } from "./txline/feed";

export interface FeedHandlers {
  onMinute(minute: number): void;
  onEvent(event: FeedEvent): void;
}

/** A source of live match data. Sessions don't care whether it's simulated or TxLINE. */
export interface MatchFeed {
  start(handlers: FeedHandlers): void;
  stop(): void;
}

/** FEED=sim (default) replays the bundled fixture; FEED=txline consumes the live TxLINE streams. */
export function createFeed(): MatchFeed {
  if (process.env.FEED === "txline") {
    const fixtureId = Number(process.env.TXLINE_FIXTURE_ID);
    if (!fixtureId) {
      throw new Error("FEED=txline requires TXLINE_FIXTURE_ID (find it with `pnpm txline:probe`).");
    }
    return new TxLineFeed(fixtureId);
  }
  return new SimulatedFeed(FIXTURE, MS_PER_MINUTE);
}
