import anchor from "@anchor-lang/core";
import { readFileSync } from "node:fs";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import idl from "../idl/nextgoal_escrow.json" with { type: "json" };

const { AnchorProvider, BN, Program, Wallet } = anchor;

const connection = new Connection("http://127.0.0.1:8899", "confirmed");
const authority = Keypair.generate();
const player = Keypair.generate();
const settlementAuthority = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(
      readFileSync(new URL("../../../_keys/devnet-test2.json", import.meta.url), "utf8"),
    ),
  ),
);
const provider = new AnchorProvider(connection, new Wallet(authority), {
  commitment: "confirmed",
  preflightCommitment: "confirmed",
});
const program = new Program(idl, provider);
const entry = LAMPORTS_PER_SOL / 10;
const seed = new TextEncoder().encode("nextgoal");

async function airdrop(recipient, sol = 2) {
  const signature = await connection.requestAirdrop(recipient, sol * LAMPORTS_PER_SOL);
  const blockhash = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature, ...blockhash }, "confirmed");
}

function escrowAddress(sessionId) {
  return PublicKey.findProgramAddressSync(
    [seed, Uint8Array.from(sessionId)],
    program.programId,
  )[0];
}

await Promise.all([
  airdrop(authority.publicKey),
  airdrop(player.publicKey),
  airdrop(settlementAuthority.publicKey),
]);

const sessionId = Array(32).fill(7);
const escrow = escrowAddress(sessionId);
const initialize = await program.methods
  .initializeSession(sessionId, new BN(entry))
  .accountsPartial({
    authority: authority.publicKey,
    escrow,
    systemProgram: SystemProgram.programId,
  })
  .instruction();
const hostDeposit = await program.methods
  .deposit()
  .accountsPartial({
    depositor: authority.publicKey,
    escrow,
    systemProgram: SystemProgram.programId,
  })
  .instruction();
await provider.sendAndConfirm(new Transaction().add(initialize, hostDeposit));

const playerProvider = new AnchorProvider(connection, new Wallet(player), provider.opts);
const playerProgram = new Program(idl, playerProvider);
await playerProgram.methods
  .deposit()
  .accountsPartial({
    depositor: player.publicKey,
    escrow,
    systemProgram: SystemProgram.programId,
  })
  .rpc();

const funded = await program.account.sessionEscrow.fetch(escrow);
if (!funded.prizePool.eq(new BN(entry * 2)) || funded.depositors.length !== 2) {
  throw new Error("Escrow did not record both deposits correctly.");
}

const winnerBefore = await connection.getBalance(player.publicKey);
const settlementProvider = new AnchorProvider(
  connection,
  new Wallet(settlementAuthority),
  provider.opts,
);
const settlementProgram = new Program(idl, settlementProvider);
await settlementProgram.methods
  .settle([player.publicKey])
  .accountsPartial({
    settlementAuthority: settlementAuthority.publicKey,
    authority: authority.publicKey,
    escrow,
  })
  .remainingAccounts([{ pubkey: player.publicKey, isSigner: false, isWritable: true }])
  .rpc();
const winnerAfter = await connection.getBalance(player.publicKey);
if (winnerAfter - winnerBefore !== entry * 2) {
  throw new Error("Winner did not receive the complete prize pool.");
}
if (await program.account.sessionEscrow.fetchNullable(escrow)) {
  throw new Error("Settled escrow account was not closed.");
}

// Exercise the abandoned-session refund path with a fresh PDA.
const cancelledId = Array(32).fill(8);
const cancelledEscrow = escrowAddress(cancelledId);
const initializeCancelled = await program.methods
  .initializeSession(cancelledId, new BN(entry))
  .accountsPartial({
    authority: authority.publicKey,
    escrow: cancelledEscrow,
    systemProgram: SystemProgram.programId,
  })
  .instruction();
const cancelledHostDeposit = await program.methods
  .deposit()
  .accountsPartial({
    depositor: authority.publicKey,
    escrow: cancelledEscrow,
    systemProgram: SystemProgram.programId,
  })
  .instruction();
await provider.sendAndConfirm(new Transaction().add(initializeCancelled, cancelledHostDeposit));
await playerProgram.methods
  .deposit()
  .accountsPartial({
    depositor: player.publicKey,
    escrow: cancelledEscrow,
    systemProgram: SystemProgram.programId,
  })
  .rpc();

const playerBeforeRefund = await connection.getBalance(player.publicKey);
await program.methods
  .cancel()
  .accountsPartial({ authority: authority.publicKey, escrow: cancelledEscrow })
  .remainingAccounts([
    { pubkey: authority.publicKey, isSigner: false, isWritable: true },
    { pubkey: player.publicKey, isSigner: false, isWritable: true },
  ])
  .rpc();
const playerAfterRefund = await connection.getBalance(player.publicKey);
if (playerAfterRefund - playerBeforeRefund !== entry) {
  throw new Error("Cancelled escrow did not refund the player entry.");
}

console.log("Escrow integration test passed: deposit, payout, close, and refund.");
