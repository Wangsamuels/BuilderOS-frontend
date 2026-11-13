"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { dollars, ratio, toBig, usd, type Micro } from "@/lib/money";
import { cx, dayLabel } from "@/lib/format";

/** Team colors follow the team, never its rank: the index is the team's position in the company's own team list. */
export const SERIES = ["var(--color-s1)", "var(--color-s2)", "var(--color-s3)", "var(--color-s4)", "var(--color-s5)", "var(--color-s6)", "var(--color-s7)", "var(--color-s8)"];
export const seriesColor = (teams: string[], team: string) => {
  const i = teams.indexOf(team);
  return i < 0 || i >= SERIES.length ? "#8a847c" : SERIES[i];
};

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const niceMax = (v: number) => {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
};
const tickUsd = (v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(v % 1000 ? 1 : 0)}K` : `$${v % 1 ? v.toFixed(2) : v}`);

export function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-ink-2">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px]" style={{ background: i.color }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** Chart frame with a table view, so every amount is readable as text. */
export function ChartFrame({ chart, table, legend }: { chart: ReactNode; table: ReactNode; legend?: ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        {legend ?? <span />}
        <button type="button" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable} className="text-[13px] text-ink-3 underline decoration-line-strong underline-offset-4 hover:text-ink">
          {asTable ? "View as chart" : "View as table"}
        </button>
      </div>
      {asTable ? <div className="max-h-72 overflow-auto">{table}</div> : chart}
    </div>
  );
}
export const DataTable = ({ head, rows }: { head: string[]; rows: ReactNode[][] }) => (
  <table className="w-full text-left text-sm">
    <thead className="sticky top-0 bg-surface text-[13px] text-ink-3">
      <tr>
        {head.map((h, i) => (
          <th key={h} scope="col" className={cx("border-b border-line py-2 font-medium", i > 0 && "text-right")}>
            {h}
          </th>
        ))}
      </tr>
    </thead>
    <tbody>
      {rows.map((r, i) => (
        <tr key={i} className="border-b border-line/60 last:border-0">
          {r.map((c, j) => (
            <td key={j} className={cx("py-2", j > 0 && "num text-right")}>
              {c}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
);

/** Spend per day, stacked by team. */
export function SpendByDay({ days, teams }: { days: Array<{ day: string; total: Micro; byTeam: Record<string, Micro> }>; teams: string[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 220, padL = 44, padB = 24, padT = 8;
  const max = niceMax(Math.max(...days.map((d) => dollars(d.total)), 0.01));
  const plotW = Math.max(0, width - padL);
  const plotH = H - padB - padT;
  const slot = days.length ? plotW / days.length : 0;
  const barW = Math.max(2, Math.min(24, slot - 2));
  const y = (v: number) => padT + plotH - (v / max) * plotH;
  const labelEvery = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(plotW / 64))));
  const present = teams.filter((t) => days.some((d) => toBig(d.byTeam[t]) > 0n));
  const h = hover !== null ? days[hover] : null;

  const chart = (
    <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
      {width > 0 ? (
        <svg width={width} height={H} role="img" aria-label={`Spend per day for ${days.length} days, stacked by team`}>
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={padL} x2={width} y1={y(max * f)} y2={y(max * f)} stroke="#ffffff12" />
              <text x={padL - 8} y={y(max * f) + 4} textAnchor="end" className="fill-ink-3 text-[11px]">
                {tickUsd(max * f)}
              </text>
            </g>
          ))}
          {days.map((d, i) => {
            let acc = 0;
            const x = padL + i * slot + (slot - barW) / 2;
            const segs = teams.map((t) => ({ t, v: dollars(d.byTeam[t]) })).filter((s) => s.v > 0);
            return (
              <g key={d.day} opacity={hover === null || hover === i ? 1 : 0.45}>
                {segs.map((s, si) => {
                  const y1 = y(acc + s.v), y0 = y(acc);
                  acc += s.v;
                  const top = si === segs.length - 1;
                  const hgt = Math.max(0.5, y0 - y1 - (top ? 0 : 2));
                  return top ? (
                    <path key={s.t} d={`M${x},${y1 + hgt}V${y1 + Math.min(4, hgt)}a${Math.min(4, barW / 2)},${Math.min(4, hgt)} 0 0 1 ${Math.min(4, barW / 2)},-${Math.min(4, hgt)}H${x + barW - Math.min(4, barW / 2)}a${Math.min(4, barW / 2)},${Math.min(4, hgt)} 0 0 1 ${Math.min(4, barW / 2)},${Math.min(4, hgt)}V${y1 + hgt}Z`} fill={seriesColor(teams, s.t)} />
                  ) : (
                    <rect key={s.t} x={x} y={y1 + 2} width={barW} height={hgt} fill={seriesColor(teams, s.t)} />
                  );
                })}
                {i % labelEvery === 0 ? (
                  <text x={padL + i * slot + slot / 2} y={H - 6} textAnchor="middle" className="fill-ink-3 text-[11px]">
                    {dayLabel(d.day)}
                  </text>
                ) : null}
                <rect x={padL + i * slot} y={padT} width={slot} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} aria-label={`${dayLabel(d.day)}: ${usd(d.total)}`} style={{ outline: "none" }} />
              </g>
            );
          })}
        </svg>
      ) : (
        <div style={{ height: H }} />
      )}
      {h && hover !== null ? (
        <div className="pointer-events-none absolute top-0 z-10 min-w-40 rounded-[10px] border border-line-strong bg-raised px-3 py-2 text-[13px] shadow-[0_12px_40px_#000a]" style={{ left: Math.min(Math.max(0, padL + hover * slot + slot / 2 - 80), Math.max(0, width - 170)) }}>
          <div className="mb-1 flex justify-between gap-4 font-medium text-ink">
            <span>{dayLabel(h.day)}</span>
            <span className="num">{usd(h.total)}</span>
          </div>
          {teams
            .filter((t) => toBig(h.byTeam[t]) > 0n)
            .map((t) => (
              <div key={t} className="flex items-center justify-between gap-4 text-ink-2">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-[2px]" style={{ background: seriesColor(teams, t) }} />
                  {t}
                </span>
                <span className="num">{usd(h.byTeam[t])}</span>
              </div>
            ))}
        </div>
      ) : null}
    </div>
  );
  return (
    <ChartFrame
      legend={present.length > 1 ? <Legend items={present.map((t) => ({ label: t, color: seriesColor(teams, t) }))} /> : undefined}
      chart={chart}
      table={<DataTable head={["Day", ...present, "Total"]} rows={[...days].reverse().map((d) => [dayLabel(d.day), ...present.map((t) => usd(d.byTeam[t] ?? "0")), usd(d.total)])} />}
    />
  );
}

/** Tasks finished per day: one series, so the title names it and there is no legend. */
export function CountByDay({ days, noun }: { days: Array<{ day: string; done: number }>; noun: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 120, padB = 22, padT = 16;
  const max = Math.max(1, ...days.map((d) => d.done));
  const slot = days.length ? width / days.length : 0;
  const barW = Math.max(2, Math.min(20, slot - 2));
  const labelEvery = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(width / 64))));
  return (
    <ChartFrame
      chart={
        <div ref={ref} onMouseLeave={() => setHover(null)}>
          {width > 0 ? (
            <svg width={width} height={H} role="img" aria-label={`${noun} per day`}>
              <line x1={0} x2={width} y1={H - padB} y2={H - padB} stroke="#ffffff1f" />
              {days.map((d, i) => {
                const hgt = (d.done / max) * (H - padB - padT);
                const x = i * slot + (slot - barW) / 2;
                return (
                  <g key={d.day}>
                    {d.done > 0 ? <rect x={x} y={H - padB - hgt} width={barW} height={hgt} rx={Math.min(4, barW / 2)} fill="var(--color-s3)" opacity={hover === null || hover === i ? 1 : 0.45} /> : null}
                    {hover === i ? (
                      <text x={i * slot + slot / 2} y={Math.max(11, H - padB - hgt - 5)} textAnchor="middle" className="fill-ink text-[11px] font-medium">
                        {d.done}
                      </text>
                    ) : null}
                    {i % labelEvery === 0 ? (
                      <text x={Math.max(18, i * slot + slot / 2)} y={H - 5} textAnchor="middle" className="fill-ink-3 text-[11px]">
                        {dayLabel(d.day)}
                      </text>
                    ) : null}
                    <rect x={i * slot} y={0} width={slot} height={H - padB} fill="transparent" onMouseEnter={() => setHover(i)}>
                      <title>{`${dayLabel(d.day)}: ${d.done}`}</title>
                    </rect>
                  </g>
                );
              })}
            </svg>
          ) : (
            <div style={{ height: H }} />
          )}
        </div>
      }
      table={<DataTable head={["Day", noun]} rows={[...days].reverse().map((d) => [dayLabel(d.day), d.done])} />}
    />
  );
}

/** Ranked horizontal bars with the value at the tip (spend by model, by seller). */
export function RankBars({ rows, color = "var(--color-s1)" }: { rows: Array<{ label: string; amount: Micro; note?: string }>; color?: string }) {
  const max = rows.reduce((m, r) => (toBig(r.amount) > m ? toBig(r.amount) : m), 0n);
  if (!rows.length) return <p className="py-6 text-center text-sm text-ink-3">No spend in this range.</p>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label} title={`${r.label}: ${usd(r.amount)}${r.note ? ` (${r.note})` : ""}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-ink">{r.label}</span>
            <span className="num shrink-0 text-ink">
              {usd(r.amount)}
              {r.note ? <span className="ml-2 font-sans text-[13px] text-ink-3">{r.note}</span> : null}
            </span>
          </div>
          <div className="h-2 rounded-r-full bg-white/[0.06]">
            <div className="h-full rounded-r-full" style={{ width: `${Math.max(1.5, ratio(r.amount, max) * 100)}%`, background: color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** A team's budget: spent, reserved, and what is left. Segments are separated by a surface gap. */
export function BudgetBar({ spent, reserved, budget, color = "var(--color-ember)" }: { spent: Micro; reserved: Micro; budget: Micro; color?: string }) {
  const s = Math.min(100, ratio(spent, budget) * 100);
  const r = Math.min(100 - s, ratio(reserved, budget) * 100);
  return (
    <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`${usd(spent)} spent and ${usd(reserved)} reserved of ${usd(budget)}`}>
      {s > 0 ? <div style={{ width: `${s}%`, background: color }} className="min-w-[3px]" title={`Spent ${usd(spent)}`} /> : null}
      {r > 0 ? <div style={{ width: `${r}%`, background: color, opacity: 0.45 }} className="min-w-[3px]" title={`Reserved ${usd(reserved)}`} /> : null}
      <div className="flex-1 bg-white/[0.07]" title="Available" />
    </div>
  );
}

/** Task counts by status as one segmented bar with a legend. Status colors are reserved for state. */
export const STATUS: Record<string, { label: string; color: string }> = {
  done: { label: "Done", color: "var(--color-green)" },
  review: { label: "In review", color: "var(--color-blue)" },
  running: { label: "Running", color: "var(--color-ember)" },
  assigned: { label: "Queued", color: "#6f6a78" },
  ready: { label: "Queued", color: "#6f6a78" },
  pending: { label: "Not started", color: "#4a4756" },
  paused: { label: "Waiting on you", color: "var(--color-amber)" },
  failed: { label: "Failed", color: "var(--color-red)" },
};
const ORDER = ["done", "review", "running", "paused", "failed", "assigned", "ready", "pending"];
export function StatusBar({ counts, showLegend = true }: { counts: Record<string, number | string>; showLegend?: boolean }) {
  const entries = ORDER.map((k) => [k, Number(counts[k] ?? 0)] as const).filter(([, n]) => n > 0);
  const total = entries.reduce((a, [, n]) => a + n, 0);
  if (!total) return <p className="text-[13px] text-ink-3">No tasks yet</p>;
  return (
    <div>
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={entries.map(([k, n]) => `${n} ${STATUS[k].label.toLowerCase()}`).join(", ")}>
        {entries.map(([k, n]) => (
          <div key={k} style={{ flexGrow: n, background: STATUS[k].color }} className="min-w-[4px]" title={`${STATUS[k].label}: ${n}`} />
        ))}
      </div>
      {showLegend ? (
        <ul className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[13px] text-ink-2">
          {entries.map(([k, n]) => (
            <li key={k} className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: STATUS[k].color }} />
              <span className="num text-ink">{n}</span> {STATUS[k].label.toLowerCase()}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
