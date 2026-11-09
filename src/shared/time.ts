// Saat/tarih yardımcıları. Hem sunucu hem istemci kullanır.

export const DAY_MINUTES = 24 * 60;

/** "HH:mm" -> dakika (gece yarısından itibaren) */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** dakika -> "HH:mm" (24 saati aşarsa sarar) */
export function toHHMM(minutes: number): string {
  const m = ((Math.round(minutes) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function isValidHHMM(v: unknown): v is string {
  return typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

export function isValidDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** YYYY-MM-DD -> Date (UTC gece yarısı) */
export function parseDate(date: string): Date {
  return new Date(date + "T00:00:00Z");
}

/** Date -> YYYY-MM-DD (UTC) */
export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Yerel saatte bugünün YYYY-MM-DD değeri */
export function todayLocal(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(date: string, days: number): string {
  const d = parseDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDate(d);
}

/** 0 = Pazar ... 6 = Cumartesi */
export function weekday(date: string): number {
  return parseDate(date).getUTCDay();
}

/** Haftanın Pazartesi'si */
export function weekStart(date: string): string {
  const wd = weekday(date);
  const diff = wd === 0 ? -6 : 1 - wd;
  return addDays(date, diff);
}

export function monthStart(date: string): string {
  return date.slice(0, 8) + "01";
}

export function monthEnd(date: string): string {
  const d = parseDate(monthStart(date));
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return formatDate(d);
}

export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  let guard = 0;
  while (cur <= to && guard++ < 400) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / 86400000);
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} dk`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} sa ${m} dk` : `${h} sa`;
}

export const WEEKDAY_NAMES_TR = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
export const WEEKDAY_SHORT_TR = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
export const MONTH_NAMES_TR = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

export function formatDateTR(date: string, withWeekday = true): string {
  const d = parseDate(date);
  const s = `${d.getUTCDate()} ${MONTH_NAMES_TR[d.getUTCMonth()]}`;
  return withWeekday ? `${s} ${WEEKDAY_NAMES_TR[d.getUTCDay()]}` : s;
}
