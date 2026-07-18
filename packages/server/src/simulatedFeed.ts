import type { FeedEvent } from "@matchpot/shared";
import type { FeedHandlers, MatchFeed } from "./feed";

/** Replays a recorded feed in real time, one match minute per tick. */
export class SimulatedFeed implements MatchFeed {
  private timer: NodeJS.Timeout | null = null;
  private minute = -1;
  private readonly lastMinute: number;
  private handlers: FeedHandlers | null = null;

  constructor(
    private readonly feed: FeedEvent[],
    private readonly msPerMinute: number,
  ) {
    this.lastMinute = Math.max(...feed.map((e) => e.minute));
  }

  start(handlers: FeedHandlers) {
    this.handlers = handlers;
    this.handlers.onReady();
    this.advance();
    this.timer = setInterval(() => this.advance(), this.msPerMinute);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private advance() {
    if (!this.handlers) return;
    this.minute += 1;
    this.handlers.onMinute(this.minute);
    for (const event of this.feed) {
      if (event.minute === this.minute) this.handlers.onEvent(event);
    }
    if (this.minute >= this.lastMinute) this.stop();
  }
}
