export function addMonths(d: Date, months: number): Date {
  const r = new Date(d);
  const day = r.getUTCDate();
  r.setUTCMonth(r.getUTCMonth() + months);
  if (r.getUTCDate() < day) r.setUTCDate(0); // clamp (e.g. 31 Jan + 1 month)
  return r;
}
/** Pharma convention: expiry = mfg + shelf life − 1 day (last valid day). */
export function expiryFrom(mfg: Date, shelfLifeMonths: number): Date {
  const e = addMonths(mfg, shelfLifeMonths);
  e.setUTCDate(e.getUTCDate() - 1);
  return e;
}
export const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000);
export const startOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1));
export const monthKey = (d: Date) => d.toISOString().slice(0, 7);
