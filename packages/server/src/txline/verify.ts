// Read-only preflight check for the TxLINE integration — costs nothing, needs no funded wallet.
//
//   pnpm txline:verify                      (devnet by default via TXLINE_NETWORK)
//
// Verifies: RPC + program reachable, IDL decodes the on-chain pricing matrix
// (shows free-tier pricing), guest JWT endpoint works, and data endpoints
// respond (403 without an activated API token is the expected outcome there).

import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import TxoracleIdl from "./idl/txoracle.json";
import type { Txoracle } from "./idl/txoracle";
import { WORLD_CUP_COMPETITION_ID, networkConfig } from "./config";
import { fetchGuestJwt } from "./auth";

async function main() {
  const net = networkConfig();
  const network = process.env.TXLINE_NETWORK ?? "mainnet";
  console.log(`Network: ${network} (${net.rpcUrl})`);

  // 1. On-chain: decode the pricing matrix with our IDL (read-only, throwaway wallet).
  const connection = new Connection(net.rpcUrl, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(Keypair.generate()), {});
  const idl = { ...(TxoracleIdl as Record<string, unknown>), address: net.programId };
  const program = new anchor.Program<Txoracle>(idl as unknown as Txoracle, provider);
  const [pricingMatrixPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pricing_matrix")],
    program.programId,
  );
  const matrix = await program.account.pricingMatrix.fetch(pricingMatrixPda);
  console.log(`\n✅ Program ${net.programId} reachable; pricing matrix decoded.`);
  console.log("   level  TxL/week  sampling(s)  leagueBundle  marketBundle");
  for (const row of matrix.rows as any[]) {
    console.log(
      `   ${String(row.rowId).padStart(5)}  ${String(row.pricePerWeekToken).padStart(8)}  ${String(
        row.samplingIntervalSec,
      ).padStart(11)}  ${String(row.leagueBundleId).padStart(12)}  ${String(
        row.marketBundleId,
      ).padStart(12)}`,
    );
  }

  // 2. Guest JWT.
  const jwt = await fetchGuestJwt();
  console.log(`\n✅ Guest JWT issued (${jwt.slice(0, 24)}…)`);

  // 3. Data endpoint — expected to reject us until txline:setup activates a token.
  const epochDay = Math.floor(Date.now() / 86_400_000);
  const res = await fetch(
    `${net.apiBaseUrl}/fixtures/snapshot?competitionId=${WORLD_CUP_COMPETITION_ID}&startEpochDay=${epochDay}`,
    { headers: { Authorization: `Bearer ${jwt}` } },
  );
  const body = await res.text();
  if (res.ok) {
    console.log(`\n✅ Fixtures endpoint returned data without an API token:`);
    console.log(body.slice(0, 600));
  } else {
    console.log(
      `\n✅ Fixtures endpoint responded ${res.status} (expected without an activated API token): ${body.slice(0, 200)}`,
    );
  }

  console.log("\nPreflight complete. Fund a wallet and run `pnpm txline:setup` to activate.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
