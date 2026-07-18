# NextGoal ⚽

Live prediction battles for the World Cup, built for the TXODDS hackathon (consumer & fan experiences track). Friends join a session, get prompted with prediction questions during the match, and the player with the most points at full time takes the SOL prize pot.

**This first build:** two players, England vs Mexico replayed from a TXODDS-style feed, one recurring question — *Who scores the next goal?* Correct picks pay out `100 × live next-goal odds` in points, so backing the underdog pays more.

## Run it

```bash
pnpm install
pnpm dev        # game server on :3001, Next.js on :3000
```

Open http://localhost:3000 in **two browser windows** (or one normal + one incognito). Create a session in one, join with the 4-letter code in the other, and the host kicks off. The match replays 90 minutes at ~800 ms per minute (≈72 s); tune with `MS_PER_MINUTE=2000 pnpm dev`.

## Architecture

```
packages/
  shared/   Types shared by server & client (events, session state, socket contract)
  server/   Socket.IO game server — sessions, match engine, scoring (in-memory)
  web/      Next.js app — join/lobby/live match/full-time screens
```

- **`server/src/fixture.ts`** — the England vs Mexico timeline, shaped like a TXODDS live feed: match events (goals, half-time) interleaved with next-goal odds ticks. **This is the TXODDS integration point**: swap the static array for a subscriber that maps real TXODDS push messages onto `FeedEvent` and feeds them to `MatchEngine`.
- **`server/src/matchEngine.ts`** — replays the feed one match minute per tick.
- **`server/src/session.ts`** — all game rules: join/rejoin (same name reclaims a disconnected seat), question lifecycle (opens at kickoff and after every goal, resolved on the next goal, voided at full time), odds-weighted scoring, winner calculation. Session state lives in memory — persistence can be added behind `SessionStore` later without touching game logic.

## Roadmap

- **Anchor / SOL prize pot** — escrow program: both players deposit at kickoff, server (or an oracle-signed result) releases the pot to the winner at full time. The winner IDs are already computed in `Session.finish()`.
- **Real TXODDS feed** — replace the fixture as described above.
- **Supabase** — auth/profiles, match history, and persistent leaderboards once the live loop is solid.
- **More question types** — next scorer by player, over/under, will there be a goal before 60', etc. The question/result plumbing is generic enough to extend.
- **More than two players** — bump `MAX_PLAYERS` in `session.ts`; the UI lobby is the only 2-player-specific piece.
