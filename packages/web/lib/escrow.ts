import { AnchorProvider, BN, Program } from "@anchor-lang/core";
import { ENTRY_LAMPORTS } from "@nextgoal/shared";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionSignature,
} from "@solana/web3.js";
import idl from "../idl/nextgoal_escrow.json";
import type { NextgoalEscrow } from "../idl/nextgoal_escrow";

const PROGRAM_ID = new PublicKey(idl.address);
const ESCROW_SEED = new TextEncoder().encode("nextgoal");

export interface EscrowSnapshot {
  address: string;
  authority: string;
  entryLamports: number;
  prizePoolLamports: number;
  depositors: string[];
}

function sessionIdBytes(sessionId: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/i.test(sessionId)) throw new Error("Invalid session escrow ID.");
  return Uint8Array.from(sessionId.match(/.{2}/g)!, (byte) => Number.parseInt(byte, 16));
}

function getEscrowAddress(sessionId: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [ESCROW_SEED, sessionIdBytes(sessionId)],
    PROGRAM_ID,
  )[0];
}

function getProgram(connection: Connection, wallet: AnchorWallet): Program<NextgoalEscrow> {
  // Anchor's browser provider only needs the three methods exposed by
  // wallet-adapter's AnchorWallet. Its public barrel currently types `Wallet`
  // as the stricter Node wallet class, so keep the compatibility cast here.
  const provider = new AnchorProvider(connection, wallet as never, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  return new Program<NextgoalEscrow>(idl as unknown as NextgoalEscrow, provider);
}

export async function getEscrowSnapshot(
  connection: Connection,
  wallet: AnchorWallet,
  sessionId: string,
): Promise<EscrowSnapshot | null> {
  const program = getProgram(connection, wallet);
  const address = getEscrowAddress(sessionId);
  const account = await program.account.sessionEscrow.fetchNullable(address);
  if (!account) return null;

  return {
    address: address.toBase58(),
    authority: account.authority.toBase58(),
    entryLamports: account.entryLamports.toNumber(),
    prizePoolLamports: account.prizePool.toNumber(),
    depositors: account.depositors.map((key) => key.toBase58()),
  };
}

/** Initializes a host's PDA if needed, then ensures this wallet has paid once. */
export async function ensureEscrowDeposit(
  connection: Connection,
  wallet: AnchorWallet,
  sessionId: string,
  isAuthority: boolean,
): Promise<TransactionSignature | null> {
  const program = getProgram(connection, wallet);
  const escrow = getEscrowAddress(sessionId);
  const existing = await program.account.sessionEscrow.fetchNullable(escrow);

  if (existing?.depositors.some((key) => key.equals(wallet.publicKey))) return null;

  if (!existing) {
    if (!isAuthority) throw new Error("The host has not initialized this prize pool yet.");

    const initialize = await program.methods
      .initializeSession(Array.from(sessionIdBytes(sessionId)), new BN(ENTRY_LAMPORTS))
      .accountsPartial({
        authority: wallet.publicKey,
        escrow,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    const deposit = await program.methods
      .deposit()
      .accountsPartial({
        depositor: wallet.publicKey,
        escrow,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    return program.provider.sendAndConfirm!(new Transaction().add(initialize, deposit));
  }

  return program.methods
    .deposit()
    .accountsPartial({
      depositor: wallet.publicKey,
      escrow,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function settleEscrow(
  connection: Connection,
  wallet: AnchorWallet,
  sessionId: string,
  winnerAddresses: string[],
): Promise<TransactionSignature> {
  const program = getProgram(connection, wallet);
  const escrow = getEscrowAddress(sessionId);
  const winners = winnerAddresses.map((address) => new PublicKey(address));

  return program.methods
    .settle(winners)
    .accountsPartial({ authority: wallet.publicKey, escrow })
    .remainingAccounts(
      winners.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })),
    )
    .rpc();
}

export async function cancelEscrow(
  connection: Connection,
  wallet: AnchorWallet,
  sessionId: string,
): Promise<TransactionSignature> {
  const program = getProgram(connection, wallet);
  const escrow = getEscrowAddress(sessionId);
  const account = await program.account.sessionEscrow.fetch(escrow);

  return program.methods
    .cancel()
    .accountsPartial({ authority: wallet.publicKey, escrow })
    .remainingAccounts(
      account.depositors.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })),
    )
    .rpc();
}
