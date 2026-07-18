import fs from "node:fs";
import { CREDENTIALS_PATH, networkConfig } from "./config";

export interface TxLineAuth {
  jwt: string;
  apiToken: string;
  /** Fetches a fresh guest JWT (they are short-lived; the API token lasts the subscription). */
  renewJwt(): Promise<string>;
}

export async function fetchGuestJwt(): Promise<string> {
  const { jwtUrl } = networkConfig();
  const res = await fetch(jwtUrl, { method: "POST" });
  if (!res.ok) throw new Error(`Guest JWT request failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { token: string };
  return body.token;
}

export function saveApiToken(apiToken: string) {
  fs.writeFileSync(
    CREDENTIALS_PATH,
    JSON.stringify({ network: process.env.TXLINE_NETWORK ?? "mainnet", apiToken }, null, 2),
  );
}

export function loadApiToken(): string {
  const environmentToken = process.env.TXLINE_API_TOKEN?.trim();
  if (environmentToken) return environmentToken;
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      "No TxLINE credentials found. Set TXLINE_API_TOKEN or run `pnpm txline:setup` first.",
    );
  }
  const { apiToken } = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
  return apiToken;
}

export async function ensureAuth(): Promise<TxLineAuth> {
  const apiToken = loadApiToken();
  const auth: TxLineAuth = {
    jwt: await fetchGuestJwt(),
    apiToken,
    renewJwt: async () => {
      auth.jwt = await fetchGuestJwt();
      return auth.jwt;
    },
  };
  return auth;
}

export function dataHeaders(auth: TxLineAuth): Record<string, string> {
  return {
    Authorization: `Bearer ${auth.jwt}`,
    "X-Api-Token": auth.apiToken,
  };
}

/** GET against the TxLINE data API with automatic JWT renewal on 401/403. */
export async function apiGet<T>(auth: TxLineAuth, path: string): Promise<T> {
  const { apiBaseUrl } = networkConfig();
  const doFetch = () => fetch(`${apiBaseUrl}${path}`, { headers: dataHeaders(auth) });
  let res = await doFetch();
  if (res.status === 401 || res.status === 403) {
    await auth.renewJwt();
    res = await doFetch();
  }
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}
