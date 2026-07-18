// Scans recent 5-min intervals for recorded scores updates (pnpm txline:scan).
// Useful for inspecting real scores record shapes without waiting for a live goal.
import { apiGet, ensureAuth } from "./auth";

async function main() {
  const auth = await ensureAuth();
  const msPerInterval = 300_000;
  const now = Date.now();
  let found = 0;
  for (let i = 0; i < 288 && found < 3; i++) {
    const t = new Date(now - i * msPerInterval);
    const epochDay = Math.floor(t.getTime() / 86_400_000);
    const hour = t.getUTCHours();
    const interval = Math.floor(t.getUTCMinutes() / 5);
    try {
      const data = await apiGet<unknown[]>(auth, `/scores/updates/${epochDay}/${hour}/${interval}`);
      if (Array.isArray(data) && data.length > 0) {
        found++;
        console.log(`\n=== ${data.length} update(s) @ day ${epochDay} hour ${hour} interval ${interval} ===`);
        console.dir(data.slice(0, 2), { depth: null });
      }
    } catch {
      // interval empty or endpoint variant — keep scanning
    }
  }
  if (!found) console.log("No scores updates found in the last 24h of intervals.");
}

main().then(() => process.exit(0));
