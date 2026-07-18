// TxLINE network configuration (see https://txline-docs.txodds.com/documentation/worldcup)

export interface TxLineNetworkConfig {
  apiBaseUrl: string;
  jwtUrl: string;
  rpcUrl: string;
  programId: string;
  tokenMint: string;
}

const NETWORKS: Record<string, TxLineNetworkConfig> = {
  mainnet: {
    apiBaseUrl: "https://txline.txodds.com/api",
    jwtUrl: "https://txline.txodds.com/auth/guest/start",
    rpcUrl: process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
    programId: "9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA",
    tokenMint: "Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL",
  },
  devnet: {
    apiBaseUrl: "https://txline-dev.txodds.com/api",
    jwtUrl: "https://txline-dev.txodds.com/auth/guest/start",
    rpcUrl: process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
    programId: "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
    tokenMint: "4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG",
  },
};

export function networkConfig(): TxLineNetworkConfig {
  const network = process.env.TXLINE_NETWORK ?? "mainnet";
  const config = NETWORKS[network];
  if (!config) throw new Error(`Unknown TXLINE_NETWORK "${network}" (mainnet | devnet)`);
  return config;
}

/** World Cup free tiers: 1 = 60s delayed, 12 = real-time (mainnet only). */
export const SERVICE_LEVEL = Number(process.env.TXLINE_SERVICE_LEVEL ?? 12);
export const SUBSCRIPTION_WEEKS = 4;

/** FIFA World Cup competition id used by the fixtures endpoint. */
export const WORLD_CUP_COMPETITION_ID = 72;

export const CREDENTIALS_PATH = new URL("../../.txline-credentials.json", import.meta.url)
  .pathname;
