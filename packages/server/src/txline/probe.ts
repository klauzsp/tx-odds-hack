// Explore the live TxLINE feed. Requires `pnpm txline:setup` to have run.
//
//   pnpm txline:probe                 # list World Cup fixtures for today/yesterday
//   pnpm txline:probe <fixtureId>     # snapshot that fixture, then tail its stream messages
//
// Use this at the hackathon to (1) find the England vs Mexico fixture id and
// (2) inspect real scores/odds payload shapes to refine the mapping in feed.ts.

import { apiGet, ensureAuth } from "./auth";
import { openStream } from "./stream";
import { WORLD_CUP_COMPETITION_ID } from "./config";

async function main() {
  const auth = await ensureAuth();
  const fixtureArg = process.argv[2] ? Number(process.argv[2]) : undefined;

  const epochDay = Math.floor(Date.now() / 86_400_000);
  for (const day of [epochDay, epochDay - 1]) {
    try {
      const fixtures = await apiGet<unknown>(
        auth,
        `/fixtures/snapshot?competitionId=${WORLD_CUP_COMPETITION_ID}&startEpochDay=${day}`,
      );
      console.log(`\n=== Fixtures (epochDay ${day}) ===`);
      console.dir(fixtures, { depth: null });
    } catch (err) {
      console.error(`fixtures snapshot failed for day ${day}:`, err);
    }
  }

  if (fixtureArg) {
    try {
      const scores = await apiGet<unknown>(auth, `/scores/snapshot/${fixtureArg}`);
      console.log(`\n=== Scores snapshot for fixture ${fixtureArg} ===`);
      console.dir(scores, { depth: null });
    } catch (err) {
      console.error("scores snapshot failed:", err);
    }
    try {
      const odds = await apiGet<unknown>(auth, `/odds/snapshot/${fixtureArg}?asOf=${Date.now()}`);
      console.log(`\n=== Odds snapshot for fixture ${fixtureArg} ===`);
      console.dir(odds, { depth: null });
    } catch (err) {
      console.error("odds snapshot failed:", err);
    }
  }

  console.log("\nTailing scores + odds streams (Ctrl-C to stop)…");
  const show = (label: string) => (raw: string) => {
    if (fixtureArg && !raw.includes(String(fixtureArg))) return;
    console.log(`[${label}]`, raw);
  };
  openStream("/scores/stream", auth, show("scores"), "scores");
  openStream("/odds/stream", auth, show("odds"), "odds");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
