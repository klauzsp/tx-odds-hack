# MatchPot ⚽

Live prediction battles for the World Cup, built for the TXODDS hackathon (consumer & fan experiences track). Friends join a session, get prompted with prediction questions during the match, and the player with the most points at full time takes the SOL prize pot.

**Current build:** two players choose either a verified World Cup TxLINE replay or an upcoming live fixture. The demo catalogue contains four historical matches, France–England in the third-place play-off, and Spain–Argentina in the final. Upcoming matches show a live countdown and remain free pending lobbies; escrow deposits open 15 minutes before kickoff, and the match cannot start early. Sessions that remain unfunded five minutes after kickoff expire automatically, with any partial deposit refunded by the application. Prediction questions pop up at random moments during the match — *Who scores the next goal?* (pays `100 × TXODDS-derived odds`, capped at 6×), *Which team picks up the next card?*, *Who wins the next corner?* (flat 150 pts). Each question has a 12-match-minute answer window, then locks and waits for its event to happen; unresolved questions void at full time.

For an instant single-browser demo, choose a historical replay and select **Practice free vs MatchBot**. Practice uses the same feed, questions, and scoring engine, but requires no wallet or SOL and never creates an escrow. MatchBot answers after a short human-like delay, favours teams using the current odds, and occasionally misses a question.

## Run it

```bash
pnpm install
pnpm dev  # game server on :3001, Next.js on :3000
```

Open http://localhost:3000 in **two browser windows** (or one normal + one incognito). Create a session in one, join with the 4-letter code in the other, and the host kicks off. The match replays 90 minutes at ~800 ms per minute (≈72 s); tune with `MS_PER_MINUTE=2000 pnpm dev`.

## Architecture

```
packages/
  shared/   Types shared by server & client (events, session state, socket contract)
  server/   Socket.IO game server — sessions, match engine, scoring (in-memory)
  web/      Next.js app — join/lobby/live match/full-time screens
programs/
  matchpot_escrow/  Anchor program — one SOL escrow PDA per game session
```

- **`server/src/feed.ts`** — feed abstraction. Every session owns its selected fixture and feed instance; completed fixtures replay their historical data and upcoming fixtures consume live SSE streams after kickoff.
- **`server/src/simulatedFeed.ts`** — paces recorded TxLINE events at demo speed for historical selections.
- **`server/src/txline/`** — real [TxLINE](https://txline-docs.txodds.com/documentation/quickstart) integration (see below).
- **`server/src/session.ts`** — all game rules: join/rejoin (the connected wallet reclaims its seat), question lifecycle (opens at kickoff and after every goal, resolved on the next goal, voided at full time), odds-weighted scoring, winner calculation. Session state lives in memory — persistence can be added behind `SessionStore` later without touching game logic.

## Deploying the demo

Deploy the two runtime processes separately:

1. Deploy the Socket.IO service from the repository root using `render.yaml`. Set
   `TXLINE_API_TOKEN` to the `apiToken` in the ignored
   `packages/server/.txline-credentials.json`, and set
   `ESCROW_SETTLER_SECRET_KEY` to the complete JSON array in the ignored
   `_keys/devnet-test2.json`. `SOLANA_RPC_URL` is optional; without it the server
   uses Solana's public devnet endpoint. Keep `TXLINE_NETWORK` equal to the
   `network` recorded in the credentials file (the supplied blueprint uses devnet).
2. Import the same GitHub repository into Vercel, set its Root Directory to
   `packages/web`, and add `NEXT_PUBLIC_SERVER_URL` with the HTTPS URL of the
   deployed game server. `NEXT_PUBLIC_SOLANA_RPC_URL` is optional.
3. Deploy the Vercel project. Pushes to `main` update production automatically;
   other branches receive Vercel preview deployments.

The free Render service sleeps after 15 minutes without inbound traffic, so open
its health URL shortly before a demo. Use an always-on instance if cold starts are
unacceptable. Never commit either secret value.

## SOL prize-pool escrow

Every new game receives a random 32-byte `escrowId`, separate from its reusable four-character invite code. The Anchor program derives a unique session account from its compatibility seed and that `escrowId`, so sessions never share a pot. Historical sessions initialize that PDA and collect entries immediately. Upcoming sessions remain free until their entry window opens; the host's first deposit initializes the PDA and the second player then funds it. The server verifies both wallets against the on-chain account before kickoff.

At kickoff the application locks the funded escrow, permanently disabling host cancellation. At full time the server automatically signs and submits settlement using the dedicated `_keys/devnet-test2.json` signer. The host has no payout authority. The program pays only when that application signer authorizes the server-computed winner, supports an equal split for tied winners, and returns every player's entry when all scores are zero. It closes the settled account and returns account rent to the host. Before kickoff the host can still cancel an abandoned lobby; the application can refund a partially funded upcoming session after its grace period.

Build and deploy it to devnet:

```bash
pnpm anchor:build
pnpm anchor:deploy:devnet
```

The configured program ID is `Diu1knrbYFraN5oSzjEW2RBjRW1obVo2iNz7vHDVrLET`. The canonical program keypair is `_keys/matchpot_escrow-program-keypair.json`; the build script restores it into the disposable `target/` directory before every build. The funded devnet deployer and upgrade authority is `_keys/devnet-test.json` (`CWgRwTdXuxsL4P8TayCyREcfgjzZU4UC7bLZeopNJN5r`). Both are intentionally gitignored: keep an encrypted off-machine backup of `_keys/` and never commit or share its contents.

Initial deployment locks rent in the durable program account. Later upgrades reuse the same program and normally cost only transaction fees (plus a temporary deployment buffer), so the deployer should not need repeated large faucet top-ups. The app and server default to devnet; override the RPCs with `NEXT_PUBLIC_SOLANA_RPC_URL` and `SOLANA_RPC_URL` when testing locally.

The server settlement signer is `6XYhnadptgK7a9UpC44XeKcWefX1pEuZHGkYHHUPE6Uj` and is kept separate from the upgrade authority. Override its local key path with `ESCROW_SETTLER_KEYPAIR` when deploying the server elsewhere.

For a local money-flow test, start a validator with the compiled program and run:

```bash
solana-test-validator --reset \
  --bpf-program Diu1knrbYFraN5oSzjEW2RBjRW1obVo2iNz7vHDVrLET \
  target/deploy/matchpot_escrow.so
pnpm --filter @matchpot/web test:escrow
```

## Live TxLINE data (World Cup free tier)

TxLINE gives free World Cup data; API access is granted via an on-chain Solana subscription (no TxL payment on the free tier, just tx fees). One-time setup with a funded mainnet wallet:

```bash
cd packages/server
TXLINE_WALLET=~/.config/solana/id.json pnpm txline:setup   # subscribe on-chain + activate API token
pnpm txline:probe                                           # list World Cup fixtures, tail live streams
pnpm txline:probe <fixtureId>                               # inspect one fixture's snapshots + messages
```

There is one startup command. The fixture selected in the UI determines the feed automatically:

```bash
pnpm dev  # historical selections replay; upcoming selections wait, then use live streams
```

The host chooses a curated fixture before creating the session. The server stores that fixture in `SessionState`; for a finished match it pulls the recorded soccer feed (`/scores/historical/{fixtureId}`), samples its real in-running odds, and replays it at demo speed. An upcoming fixture remains locked until its scheduled kickoff and then connects to the fixture's live streams. Team identity is represented internally as `HOME` and `AWAY`, so scoring and UI are not tied to specific countries. The curated catalogue lives in `DEMO_FIXTURES` in `packages/shared/src/index.ts`; an API-driven live catalogue can replace it without changing the session model.

Env knobs: `TXLINE_NETWORK` (mainnet | devnet), `TXLINE_SERVICE_LEVEL` (12 = real-time free tier, 1 = 60s delayed), and `MS_PER_MINUTE` (historical replay speed).

**Before demoing live:** run the probe during the match to confirm the stream is healthy. `txline/feed.ts` detects goals from documented participant score totals, maps the same card/corner actions verified against historical data, and derives next-goal prices from a dedicated market when present (falling back to normalized in-running 1X2 prices).

## Roadmap

- **Oracle-authorized settlement** — the demo automatically settles using an application-server signer. Replace it with signed oracle results or threshold signers before using real mainnet SOL.
- **Supabase** — auth/profiles, match history, and persistent leaderboards once the live loop is solid.
- **More question types** — next scorer by player, over/under, will there be a goal before 60', etc. The question/result plumbing is generic enough to extend.
- **More than two players** — bump `MAX_PLAYERS` in `session.ts`; the UI lobby is the only 2-player-specific piece.
