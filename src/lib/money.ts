/** Money is micro-USDC integer strings. All math is BigInt; numbers appear only for display and chart geometry. */
export type Micro = string;

export const toBig = (v: Micro | bigint | number | null | undefined): bigint => {
  if (v === null || v === undefined || v === "") return 0n;
  if (typeof v === "bigint") return v;
  try {
    return BigInt(typeof v === "number" ? Math.trunc(v) : v);
  } catch {
    return 0n;
  }
};

export const sum = (xs: Array<Micro | bigint | null | undefined>): bigint => xs.reduce<bigint>((a, x) => a + toBig(x), 0n);

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** "$1,234.56" from micro-USDC. Sub-cent values keep up to 4 decimals so a $0.002 call doesn't read as $0.00. */
export function usd(v: Micro | bigint | null | undefined, opts: { compact?: boolean; sign?: boolean } = {}): string {
  if (v === null || v === undefined) return "—";
  let n = toBig(v);
  const neg = n < 0n;
  if (neg) n = -n;
  const whole = n / 1_000_000n;
  const frac = n % 1_000_000n;
  let out: string;
  if (opts.compact && whole >= 10_000n) {
    const k = Number(whole) / 1000;
    out = k >= 1000 ? `${(k / 1000).toFixed(1)}M` : `${k.toFixed(k >= 100 ? 0 : 1)}K`;
  } else if (whole === 0n && frac > 0n && frac < 10_000n) {
    out = `0.${frac.toString().padStart(6, "0").slice(0, 4)}`;
  } else {
    // round half up to cents
    let cents = (frac + 5_000n) / 10_000n;
    let w = whole;
    if (cents === 100n) {
      w += 1n;
      cents = 0n;
    }
    out = `${group(w.toString())}.${cents.toString().padStart(2, "0")}`;
  }
  return `${neg ? "−" : opts.sign ? "+" : ""}$${out}`;
}

/** Dollars typed by a person ("12.5") to micro-USDC, or null when it isn't a valid amount. */
export function parseUsd(input: string): Micro | null {
  const s = input.trim().replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,6})?$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  return (BigInt(w) * 1_000_000n + BigInt(f.padEnd(6, "0"))).toString();
}

/** Micro-USDC to a plain dollars string for an input field. */
export function usdInput(v: Micro | bigint): string {
  const n = toBig(v);
  const frac = (n % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${n / 1_000_000n}${frac ? `.${frac}` : ""}`;
}

/** Ratio a/b as a float in [0, ∞) for chart geometry only. */
export function ratio(a: Micro | bigint, b: Micro | bigint): number {
  const d = toBig(b);
  if (d === 0n) return 0;
  return Number((toBig(a) * 10_000n) / d) / 10_000;
}

/** Chart geometry only: micro-USDC as a float number of dollars. */
export const dollars = (v: Micro | bigint | null | undefined): number => Number(toBig(v)) / 1e6;

/** yoctoNEAR string → "12.34 NEAR". */
export function near(yocto: string | bigint | null | undefined, digits = 2): string {
  const n = toBig(yocto);
  const unit = 10n ** 24n;
  const scale = 10n ** BigInt(digits);
  const v = (n * scale + unit / 2n) / unit;
  const s = v.toString().padStart(digits + 1, "0");
  return `${group(s.slice(0, -digits))}.${s.slice(-digits)} NEAR`;
}
