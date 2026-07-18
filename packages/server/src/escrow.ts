import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ENTRY_LAMPORTS, type SessionState } from "@nextgoal/shared";
import {
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("Diu1knrbYFraN5oSzjEW2RBjRW1obVo2iNz7vHDVrLET");
const SETTLEMENT_AUTHORITY = new PublicKey("6XYhnadptgK7a9UpC44XeKcWefX1pEuZHGkYHHUPE6Uj");
const ESCROW_DISCRIMINATOR = Buffer.from([251, 205, 39, 211, 38, 92, 234, 241]);
const SETTLE_DISCRIMINATOR = Buffer.from([175, 42, 185, 87, 144, 131, 102, 212]);
const connection = new Connection(
  process.env.SOLANA_RPC_URL ?? clusterApiUrl("devnet"),
  "confirmed",
);

/** Returns a user-facing error, or null when every player has funded the PDA. */
export async function verifyEscrowReady(state: SessionState): Promise<string | null> {
  try {
    const sessionId = Buffer.from(state.escrowId, "hex");
    if (sessionId.length !== 32) return "This session has an invalid escrow ID.";

    const [escrowAddress] = PublicKey.findProgramAddressSync(
      [Buffer.from("nextgoal"), sessionId],
      PROGRAM_ID,
    );
    const account = await connection.getAccountInfo(escrowAddress, "confirmed");
    if (!account) return "The session prize pool has not been initialized.";
    if (!account.owner.equals(PROGRAM_ID)) return "The prize pool has an invalid owner.";

    const data = account.data;
    if (data.length < 125 || !data.subarray(0, 8).equals(ESCROW_DISCRIMINATOR))
      return "The session prize pool data is invalid.";
    if (!data.subarray(8, 40).equals(sessionId)) return "The prize pool belongs to another session.";

    const authority = new PublicKey(data.subarray(40, 72)).toBase58();
    const hostWallet = state.players.find((player) => player.id === state.hostId)?.wallet;
    if (!hostWallet || authority !== hostWallet) return "The host does not control this prize pool.";

    const settlementAuthority = new PublicKey(data.subarray(72, 104));
    if (!settlementAuthority.equals(SETTLEMENT_AUTHORITY))
      return "The prize pool has an invalid settlement authority.";

    const entryLamports = Number(data.readBigUInt64LE(104));
    const prizePool = Number(data.readBigUInt64LE(112));
    const depositorCount = data.readUInt32LE(120);
    if (entryLamports !== ENTRY_LAMPORTS) return "The prize pool has the wrong entry fee.";
    if (data.length < 124 + depositorCount * 32) return "The depositor list is invalid.";

    const depositors = new Set<string>();
    for (let index = 0; index < depositorCount; index += 1) {
      const offset = 124 + index * 32;
      depositors.add(new PublicKey(data.subarray(offset, offset + 32)).toBase58());
    }
    if (!state.players.every((player) => depositors.has(player.wallet)))
      return "Every player must deposit before kickoff.";
    if (prizePool !== entryLamports * depositorCount)
      return "The recorded prize pool balance is inconsistent.";

    return null;
  } catch {
    return "Could not verify the prize pool on Solana. Try again in a moment.";
  }
}

function loadSettlementKeypair(): Keypair {
  const defaultPath = fileURLToPath(new URL("../../../_keys/devnet-test2.json", import.meta.url));
  const keyPath = process.env.ESCROW_SETTLER_KEYPAIR
    ? resolve(process.env.ESCROW_SETTLER_KEYPAIR)
    : defaultPath;
  const secret = JSON.parse(readFileSync(keyPath, "utf8")) as number[];
  const keypair = Keypair.fromSecretKey(Uint8Array.from(secret));
  if (!keypair.publicKey.equals(SETTLEMENT_AUTHORITY))
    throw new Error(`ESCROW_SETTLER_KEYPAIR does not match ${SETTLEMENT_AUTHORITY.toBase58()}`);
  return keypair;
}

/** Automatically pays the server-computed winner(s) using the application signer. */
export async function settleFinishedEscrow(state: SessionState): Promise<string> {
  if (state.status !== "finished" || !state.winners?.length)
    throw new Error("Cannot settle a session before its winner is known.");

  const settlementKeypair = loadSettlementKeypair();
  const sessionId = Buffer.from(state.escrowId, "hex");
  const [escrow] = PublicKey.findProgramAddressSync(
    [Buffer.from("nextgoal"), sessionId],
    PROGRAM_ID,
  );
  const authority = new PublicKey(
    state.players.find((player) => player.id === state.hostId)!.wallet,
  );
  const winners = state.winners.map((winnerId) => {
    const player = state.players.find((candidate) => candidate.id === winnerId);
    if (!player) throw new Error(`Winner ${winnerId} is not in the session.`);
    return new PublicKey(player.wallet);
  });

  const winnerCount = Buffer.alloc(4);
  winnerCount.writeUInt32LE(winners.length);
  const data = Buffer.concat([
    SETTLE_DISCRIMINATOR,
    winnerCount,
    ...winners.map((winner) => winner.toBuffer()),
  ]);
  const instruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    data,
    keys: [
      { pubkey: settlementKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: authority, isSigner: false, isWritable: true },
      { pubkey: escrow, isSigner: false, isWritable: true },
      ...winners.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })),
    ],
  });

  return sendAndConfirmTransaction(connection, new Transaction().add(instruction), [
    settlementKeypair,
  ]);
}
