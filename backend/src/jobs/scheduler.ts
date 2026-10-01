import cron from 'node-cron';
import { runSweep } from '../services/expiry.service';

/** Daily 02:00 sweep: expiry, low-stock, reorder and stale-approval notifications. Idempotent (dedupeKey). */
export function startScheduler() {
  cron.schedule('0 2 * * *', async () => {
    try { console.log('[sweep]', await runSweep()); } catch (e) { console.error('[sweep] failed', e); }
  });
  // Also run shortly after boot so a fresh deployment shows alerts immediately.
  setTimeout(() => runSweep().then((s) => console.log('[sweep:boot]', s)).catch(() => undefined), 15_000);
}
