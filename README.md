# NextGoal ⚽

Live prediction battles for the World Cup, built for the TXODDS hackathon (consumer & fan experiences track). Friends join a session, get prompted with prediction questions during the match, and the player with the most points at full time takes the SOL prize pot.

**Current build:** two players, England vs Mexico (real TxLINE data or simulation). Prediction questions pop up at random moments during the match — *Who scores the next goal?* (pays `100 × TXODDS-derived odds`, capped at 6×), *Which team picks up the next card?*, *Who wins the next corner?* (flat 150 pts). Each question has a 5-match-minute answer window, then locks and waits for its event to happen; unresolved questions void at full time. Question types live in `QUESTION_SPECS` in `server/src/session.ts` — adding a new one is a spec entry plus (if needed) a new `MatchEvent` kind.

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
programs/
  nextgoal_escrow/  Anchor program — one SOL escrow PDA per game session
```

- **`server/src/feed.ts`** — feed abstraction. `FEED=sim` (default) replays the bundled England vs Mexico fixture; `FEED=txline` consumes the real TxLINE SSE streams.
- **`server/src/fixture.ts`** + **`simulatedFeed.ts`** — the demo replay: match events (goals, half-time) interleaved with next-goal odds ticks, one match minute per tick.
- **`server/src/txline/`** — real [TxLINE](https://txline-docs.txodds.com/documentation/quickstart) integration (see below).
- **`server/src/session.ts`** — all game rules: join/rejoin (the connected wallet reclaims its seat), question lifecycle (opens at kickoff and after every goal, resolved on the next goal, voided at full time), odds-weighted scoring, winner calculation. Session state lives in memory — persistence can be added behind `SessionStore` later without touching game logic.

## SOL prize-pool escrow

Every new game receives a random 32-byte `escrowId`, separate from its reusable four-character invite code. The Anchor program derives a session account from `["nextgoal", escrowId]`, so sessions never share a pot. Creating a game initializes that PDA and deposits the host's 0.1 devnet SOL entry; joining deposits the second entry. The server verifies both wallets against the on-chain account before kickoff.

At full time the host signs the settlement transaction using the server-computed winner wallet. The program pays the complete tracked pool, supports an equal split for tied winners, closes the settled account, and returns account rent to the host. Its `cancel` instruction refunds every recorded depositor if a lobby is abandoned.

Build and deploy it to devnet:

```bash
pnpm anchor:build
solana config set --url devnet
solana balance
anchor deploy --provider.cluster devnet
```

The configured program ID is `Diu1knrbYFraN5oSzjEW2RBjRW1obVo2iNz7vHDVrLET`. Keep `target/deploy/nextgoal_escrow-keypair.json` safe: it is intentionally gitignored and controls that program address. The app and server default to devnet; override the RPCs with `NEXT_PUBLIC_SOLANA_RPC_URL` and `SOLANA_RPC_URL` when testing locally.

For a local money-flow test, start a validator with the compiled program and run:

```bash
solana-test-validator --reset \
  --bpf-program Diu1knrbYFraN5oSzjEW2RBjRW1obVo2iNz7vHDVrLET \
  target/deploy/nextgoal_escrow.so
pnpm --filter @nextgoal/web test:escrow
```

## Live TxLINE data (World Cup free tier)

TxLINE gives free World Cup data; API access is granted via an on-chain Solana subscription (no TxL payment on the free tier, just tx fees). One-time setup with a funded mainnet wallet:

```bash
cd packages/server
TXLINE_WALLET=~/.config/solana/id.json pnpm txline:setup   # subscribe on-chain + activate API token
pnpm txline:probe                                           # list World Cup fixtures, tail live streams
pnpm txline:probe <fixtureId>                               # inspect one fixture's snapshots + messages
```

Then pick a feed mode:

```bash
FEED=txline-history pnpm dev                 # ⭐ replay the REAL Mexico vs England match (fixture 18192996)
FEED=txline TXLINE_FIXTURE_ID=<id> pnpm dev  # live match via the SSE streams
pnpm dev                                     # hand-written simulation (no credentials needed)
```

`txline-history` is the hackathon demo mode: it pulls the full recorded TxLINE soccer feed for a finished match (`/scores/historical/{fixtureId}` — 1,000+ records: goals, scorers via lineups, cards, VAR, penalties) plus real in-running odds (`/odds/snapshot?asOf=…`), maps them onto game events, and replays at demo speed. Verified end-to-end: England 3–2 Mexico with Bellingham ×2, Quiñones, Kane, and Jiménez — the actual result.

Env knobs: `TXLINE_NETWORK` (mainnet | devnet), `TXLINE_SERVICE_LEVEL` (12 = real-time free tier, 1 = 60s delayed), `TXLINE_P1_TEAM` / `TXLINE_P2_TEAM` (map TxLINE participant slots to app teams, default ENG/MEX).

**Before demoing live:** the docs don't publish full stream payload examples, so `txline/feed.ts` parses defensively (goals are detected from documented stat keys 1/2 = participant total goals). Run the probe during any live match and tighten the field mapping — especially the next-goal odds market, which is currently logged but not yet mapped (`onOdds` TODO).

## Roadmap

- **Oracle-authorized settlement** — the minimal escrow trusts the session host to submit the winner wallet. Replace the host authority with a server/oracle result signature before using real mainnet SOL.
- **Next-goal odds from TxLINE** — map the real odds market in `txline/feed.ts` `onOdds` so live odds drive the payout multiplier.
- **Supabase** — auth/profiles, match history, and persistent leaderboards once the live loop is solid.
- **More question types** — next scorer by player, over/under, will there be a goal before 60', etc. The question/result plumbing is generic enough to extend.
- **More than two players** — bump `MAX_PLAYERS` in `session.ts`; the UI lobby is the only 2-player-specific piece.
