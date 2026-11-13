const rtf = typeof Intl !== "undefined" ? new Intl.RelativeTimeFormat("en", { numeric: "auto" }) : null;

export function ago(at: string | number | Date | null | undefined): string {
  if (!at) return "";
  const t = new Date(at).getTime();
  const diff = t - Date.now();
  const abs = Math.abs(diff);
  const pick: [number, Intl.RelativeTimeFormatUnit][] = [
    [60_000, "second"],
    [3_600_000, "minute"],
    [86_400_000, "hour"],
    [30 * 86_400_000, "day"],
    [365 * 86_400_000, "month"],
  ];
  if (abs < 45_000) return "just now";
  let div = 1000;
  let unit: Intl.RelativeTimeFormatUnit = "second";
  for (const [limit, u] of pick) {
    unit = u;
    if (abs < limit) break;
    div = limit;
  }
  if (abs >= 365 * 86_400_000) return new Date(t).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" });
  return rtf ? rtf.format(Math.round(diff / div), unit) : new Date(t).toLocaleString();
}

export const dateTime = (at: string | number | Date) => new Date(at).toLocaleString("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });

export function duration(ms: number | null | undefined): string {
  if (!ms) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Short form of a NEAR account: named accounts stay readable, 64-hex implicit ids are clipped. */
export function shortAccount(id: string | null | undefined): string {
  if (!id) return "";
  return /^[0-9a-f]{64}$/.test(id) ? `${id.slice(0, 6)}…${id.slice(-4)}` : id.length > 34 ? `${id.slice(0, 18)}…${id.slice(-10)}` : id;
}

export const teamOf = (departmentId: string | null | undefined) => (departmentId ? departmentId.split(".")[0] : "");
export const slugOf = (companyId: string) => companyId.split(".")[0];
export const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
export const titleCase = (s: string) => s.replace(/[_-]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
export const cx = (...xs: Array<string | false | null | undefined>) => xs.filter(Boolean).join(" ");
