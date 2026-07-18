import { ENTRY_LAMPORTS, type SessionState } from "@nextgoal/shared";
import { clusterApiUrl, Connection, PublicKey } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("Diu1knrbYFraN5oSzjEW2RBjRW1obVo2iNz7vHDVrLET");
const ESCROW_DISCRIMINATOR = Buffer.from([251, 205, 39, 211, 38, 92, 234, 241]);
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
    if (data.length < 93 || !data.subarray(0, 8).equals(ESCROW_DISCRIMINATOR))
      return "The session prize pool data is invalid.";
    if (!data.subarray(8, 40).equals(sessionId)) return "The prize pool belongs to another session.";

    const authority = new PublicKey(data.subarray(40, 72)).toBase58();
    const hostWallet = state.players.find((player) => player.id === state.hostId)?.wallet;
    if (!hostWallet || authority !== hostWallet) return "The host does not control this prize pool.";

    const entryLamports = Number(data.readBigUInt64LE(72));
    const prizePool = Number(data.readBigUInt64LE(80));
    const depositorCount = data.readUInt32LE(88);
    if (entryLamports !== ENTRY_LAMPORTS) return "The prize pool has the wrong entry fee.";
    if (data.length < 92 + depositorCount * 32) return "The depositor list is invalid.";

    const depositors = new Set<string>();
    for (let index = 0; index < depositorCount; index += 1) {
      const offset = 92 + index * 32;
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
