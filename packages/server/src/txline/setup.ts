// One-time TxLINE free-tier activation (World Cup data).
//
//   TXLINE_WALLET=~/.config/solana/id.json pnpm txline:setup
//
// Subscribes on-chain (free tier — only SOL tx fees), signs the activation
// message with the same wallet, and saves the API token to .txline-credentials.json.
// Flow mirrors github.com/txodds/tx-on-chain examples/mainnet/scripts/subscription_free_tier.ts

import fs from "node:fs";
import os from "node:os";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import nacl from "tweetnacl";
import TxoracleIdl from "./idl/txoracle.json";
import type { Txoracle } from "./idl/txoracle";
import { SERVICE_LEVEL, SUBSCRIPTION_WEEKS, networkConfig } from "./config";
import { fetchGuestJwt, saveApiToken } from "./auth";

async function main() {
  const net = networkConfig();
  const walletPath = (process.env.TXLINE_WALLET ?? "~/.config/solana/id.json").replace(
    /^~/,
    os.homedir(),
  );
  if (!fs.existsSync(walletPath)) {
    throw new Error(`Wallet not found at ${walletPath} — set TXLINE_WALLET to your keypair file.`);
  }
  const keypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf8"))),
  );
  console.log(`Wallet:  ${keypair.publicKey.toBase58()}`);
  console.log(`Network: ${process.env.TXLINE_NETWORK ?? "mainnet"} (${net.rpcUrl})`);
  console.log(`Tier:    service level ${SERVICE_LEVEL} (${SERVICE_LEVEL === 12 ? "real-time" : "60s delayed"}), ${SUBSCRIPTION_WEEKS} weeks`);

  const connection = new Connection(net.rpcUrl, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(keypair), {});
  const idl = { ...(TxoracleIdl as Record<string, unknown>), address: net.programId };
  const program = new anchor.Program<Txoracle>(idl as unknown as Txoracle, provider);
  const tokenMint = new PublicKey(net.tokenMint);

  // The free tier still needs the subscriber's Token-2022 ATA to exist.
  const userTokenAccount = getAssociatedTokenAddressSync(
    tokenMint,
    keypair.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
  );
  if (!(await connection.getAccountInfo(userTokenAccount))) {
    console.log("Creating TxL Token-2022 account…");
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        keypair.publicKey,
        userTokenAccount,
        keypair.publicKey,
        tokenMint,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
    await anchor.web3.sendAndConfirmTransaction(connection, tx, [keypair], {
      commitment: "confirmed",
    });
  }

  const [pricingMatrixPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pricing_matrix")],
    program.programId,
  );
  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_treasury_v2")],
    program.programId,
  );
  const tokenTreasuryVault = getAssociatedTokenAddressSync(
    tokenMint,
    tokenTreasuryPda,
    true,
    TOKEN_2022_PROGRAM_ID,
  );

  console.log("Subscribing on-chain…");
  const tx = await program.methods
    .subscribe(SERVICE_LEVEL, SUBSCRIPTION_WEEKS)
    .accounts({
      user: keypair.publicKey,
      pricingMatrix: pricingMatrixPda,
      tokenMint,
      userTokenAccount,
      tokenTreasuryVault,
      tokenTreasuryPda,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .transaction();
  const latest = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = latest.blockhash;
  tx.feePayer = keypair.publicKey;
  tx.sign(keypair);
  const txSig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(
    { signature: txSig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    "confirmed",
  );
  console.log(`Subscription confirmed: ${txSig}`);

  console.log("Activating API token…");
  const jwt = await fetchGuestJwt();
  const leagues: number[] = [];
  const message = new TextEncoder().encode(`${txSig}:${leagues.join(",")}:${jwt}`);
  const walletSignature = Buffer.from(nacl.sign.detached(message, keypair.secretKey)).toString(
    "base64",
  );

  const res = await fetch(`${net.apiBaseUrl}/token/activate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({ txSig, walletSignature, leagues }),
  });
  if (!res.ok) throw new Error(`Activation failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { token?: string };
  const apiToken = body.token ?? (body as unknown as string);
  saveApiToken(apiToken);

  console.log("✅ API token saved to packages/server/.txline-credentials.json");
  console.log("Next: `pnpm txline:probe` to list World Cup fixtures and watch the live streams.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
