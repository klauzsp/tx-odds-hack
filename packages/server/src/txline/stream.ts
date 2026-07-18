import { EventSource } from "eventsource";
import type { TxLineAuth } from "./auth";
import { networkConfig } from "./config";

/**
 * Opens a TxLINE SSE stream ("/scores/stream" | "/odds/stream") with auth headers
 * and automatic guest-JWT renewal, per the official tx-on-chain examples.
 */
export function openStream(
  path: string,
  auth: TxLineAuth,
  onData: (raw: string) => void,
  label: string,
): EventSource {
  const url = `${networkConfig().apiBaseUrl}${path}`;

  const source = new EventSource(url, {
    fetch: async (input, init) => {
      const attempt = (jwt: string) =>
        fetch(input, {
          ...init,
          headers: {
            ...(init?.headers as Record<string, string>),
            "Accept-Encoding": "deflate",
            Authorization: `Bearer ${jwt}`,
            "X-Api-Token": auth.apiToken,
          },
        });
      let response = await attempt(auth.jwt);
      if (response.status === 401 || response.status === 403) {
        console.log(`[txline:${label}] connection rejected, renewing JWT…`);
        response = await attempt(await auth.renewJwt());
      }
      return response;
    },
  });

  source.onopen = () => console.log(`[txline:${label}] stream connected`);
  source.onerror = (err) => console.error(`[txline:${label}] stream error`, err);
  source.onmessage = (event) => onData(event.data);
  return source;
}
