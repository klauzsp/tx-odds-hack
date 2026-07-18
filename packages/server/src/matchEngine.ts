import type { FeedEvent } from "@nextgoal/shared";

export interface EngineHandlers {
  onMinute(minute: number): void;
  onEvent(event: FeedEvent): void;
}

/**
 * Replays a feed in real time, one match minute per tick.
 * A live TXODDS subscription would call the same handlers as messages arrive.
 */
export class MatchEngine {
  private timer: NodeJS.Timeout | null = null;
  private minute = -1;
  private readonly lastMinute: number;

  constructor(
    private readonly feed: FeedEvent[],
    private readonly msPerMinute: number,
    private readonly handlers: EngineHandlers,
  ) {
    this.lastMinute = Math.max(...feed.map((e) => e.minute));
  }

  start() {
    this.advance();
    this.timer = setInterval(() => this.advance(), this.msPerMinute);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private advance() {
    this.minute += 1;
    this.handlers.onMinute(this.minute);
    for (const event of this.feed) {
      if (event.minute === this.minute) this.handlers.onEvent(event);
    }
    if (this.minute >= this.lastMinute) this.stop();
  }
}
