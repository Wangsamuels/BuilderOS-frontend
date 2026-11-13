"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cx } from "@/lib/format";
import { isApiError } from "@/api/client";

/* ---------- read-only (demo) ---------- */
const ReadOnly = createContext(false);
export const ReadOnlyProvider = ({ value, children }: { value: boolean; children: ReactNode }) => <ReadOnly.Provider value={value}>{children}</ReadOnly.Provider>;
export const useReadOnly = () => useContext(ReadOnly);
export const READ_ONLY_TIP = "Sign in to do this in your own company";

/* ---------- icons (16px stroke set) ---------- */
const paths: Record<string, string> = {
  dashboard: "M2.5 9.5h4v4h-4zM2.5 2.5h4v4.5h-4zM9.5 2.5h4v4h-4zM9.5 9h4v4.5h-4z",
  teams: "M5.5 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM1.5 13c0-2.2 1.8-3.5 4-3.5s4 1.3 4 3.5M11 7.2a1.8 1.8 0 1 0 0-3.6M11.5 9.6c1.7.2 3 1.4 3 3.4",
  work: "M2.5 4h11M2.5 8h11M2.5 12h7",
  approvals: "M8 1.8 13.5 4v4c0 3.2-2.3 5.3-5.5 6.2C4.8 13.3 2.5 11.200 2.5 8V4L8 1.8ZM5.6 8l1.7 1.7 3.1-3.3",
  money: "M8 1.5v13M11.2 4.4c-.5-.9-1.7-1.4-3.2-1.4-1.900 0-3.200.9-3.200 2.300 0 3.300 6.600 1.500 6.600 5 0 1.500-1.400 2.500-3.400 2.500-1.700 0-3-.6-3.500-1.700",
  members: "M8 7.500a2.500 2.500 0 1 0 0-5 2.500 2.500 0 0 0 0 5ZM3 13.500c0-2.500 2.200-4 5-4s5 1.500 5 4",
  settings: "M2 4.500h7M12 4.500h2M2 11.500h2M7 11.500h7M10.500 6.300a1.800 1.800 0 1 0 0-3.600 1.800 1.800 0 0 0 0 3.600ZM5.500 13.300a1.800 1.800 0 1 0 0-3.600 1.800 1.800 0 0 0 0 3.600Z",
  inbox: "M2 9.500 3.800 3h8.400L14 9.500V13H2V9.500ZM2 9.500h3.500l.8 1.500h3.400l.8-1.500H14",
  home: "M2.500 7.500 8 2.500l5.500 5v6h-3.500v-4H6v4H2.500v-6Z",
  plus: "M8 3v10M3 8h10",
  check: "m3 8.500 3.200 3.200L13 4.800",
  x: "m4 4 8 8M12 4l-8 8",
  chevron: "m4 6 4 4 4-4",
  right: "m6 3.500 4.500 4.500L6 12.500",
  back: "M10 3.500 5.500 8l4.500 4.500",
  pause: "M5.500 3v10M10.500 3v10",
  play: "M4.500 3v10l8.500-5-8.500-5Z",
  copy: "M5.500 5.500V3h7.500v7.500h-2.500M3 5.500h7.500V13H3V5.500Z",
  alert: "M8 2 14.500 13.500h-13L8 2ZM8 6.500v3.200M8 11.600v.1",
  clock: "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12ZM8 4.500V8l2.300 1.500",
  external: "M9 3h4v4M13 3 7.500 8.500M11 9.500V13H3V5h3.500",
  trash: "M3 4.500h10M6.500 4.500V3h3v1.500M4.500 4.500l.500 8.500h6l.500-8.500",
  menu: "M2.500 4.500h11M2.500 8h11M2.500 11.500h11",
  lock: "M4.500 7.500V5.300a3.500 3.500 0 0 1 7 0v2.200M3.500 7.500h9V13.500h-9V7.500Z",
  key: "M10.500 9a3.500 3.500 0 1 0-3.300-2.300L2 12v2h2.500v-1.500H6V11h1.500l1.200-1.300c.5.2 1.100.3 1.800.3ZM11 5.500v.1",
  download: "M8 2.500v8M4.800 7.500 8 10.700l3.200-3.200M2.500 13.500h11",
  spark: "M8 1.500 9.500 6.500 14.500 8 9.500 9.500 8 14.500 6.500 9.500 1.500 8 6.500 6.500 8 1.500Z",
  file: "M4 2h5.500L12.500 5v9H4V2ZM9 2v3.500h3.500",
  shield: "M8 1.800 13.500 4v4c0 3.200-2.300 5.300-5.500 6.200C4.800 13.300 2.500 11.200 2.500 8V4L8 1.800Z",
  logout: "M6.500 2.500h-4v11h4M10 5l3 3-3 3M13 8H6",
  refresh: "M13.500 8a5.500 5.500 0 1 1-1.800-4M13.500 2.500V5H11",
  more: "M3.500 8h.1M8 8h.1M12.500 8h.1",
};
export function Icon({ name, size = 16, className }: { name: keyof typeof paths | string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={cx("shrink-0", className)}>
      <path d={paths[name] ?? ""} />
    </svg>
  );
}

/* ---------- button ---------- */
type Variant = "primary" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-ember text-[#1a1206] hover:bg-[#ffc37d] font-semibold",
  secondary: "bg-raised text-ink border border-line-strong hover:bg-hover",
  ghost: "text-ink-2 hover:text-ink hover:bg-raised",
  danger: "bg-red-wash text-red border border-red/40 hover:bg-red/25",
};
const sizes = { sm: "h-8 px-3 text-[13px] gap-1.5", md: "h-10 px-4 text-sm gap-2", lg: "h-12 px-6 text-[15px] gap-2" };
const base = "inline-flex items-center justify-center whitespace-nowrap rounded-full font-medium transition-colors duration-150 select-none disabled:opacity-45 disabled:cursor-not-allowed";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof sizes; loading?: boolean; icon?: string; action?: boolean };
/** `action` marks a button that changes something: it is disabled with an explanation in the read-only demo. */
export function Button({ variant = "secondary", size = "md", loading, icon, action, className, children, disabled, title, ...rest }: ButtonProps) {
  const readOnly = useReadOnly() && action;
  return (
    <button type="button" {...rest} disabled={disabled || loading || readOnly} title={readOnly ? READ_ONLY_TIP : title} aria-busy={loading || undefined} className={cx(base, variants[variant], sizes[size], className)}>
      {loading ? <Spinner /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}
export function LinkButton({ href, variant = "secondary", size = "md", icon, className, children, ...rest }: { href: string; variant?: Variant; size?: keyof typeof sizes; icon?: string; className?: string; children: ReactNode; target?: string; rel?: string }) {
  return (
    <Link href={href} {...rest} className={cx(base, variants[variant], sizes[size], className)}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </Link>
  );
}
export const Spinner = ({ size = 14 }: { size?: number }) => (
  <span role="status" aria-label="Loading" className="inline-block rounded-full border-2 border-current border-r-transparent" style={{ width: size, height: size, animation: "orbit 0.7s linear infinite" }} />
);

/* ---------- surfaces ---------- */
export const Panel = ({ className, children, as: As = "section", ...rest }: { className?: string; children: ReactNode; as?: "section" | "div" | "article" | "li"; "aria-label"?: string; "data-testid"?: string }) => (
  <As {...rest} className={cx("panel", className)}>
    {children}
  </As>
);
export function PanelHeader({ title, hint, action }: { title: string; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {hint ? <p className="mt-0.5 text-[13px] text-ink-3">{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}
export function PageHeader({ title, sub, actions, back }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className="mb-6">
      {back ? (
        <Link href={back.href} className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
          <Icon name="back" size={14} />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[26px] leading-tight font-semibold text-ink text-balance sm:text-[30px]">{title}</h1>
          {sub ? <p className="mt-1.5 max-w-[68ch] text-ink-2">{sub}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

/* ---------- chips ---------- */
type Tone = "neutral" | "green" | "blue" | "amber" | "red" | "ember";
const tones: Record<Tone, string> = {
  neutral: "bg-raised text-ink-2 border-line-strong",
  green: "bg-green-wash text-green border-green/30",
  blue: "bg-blue-wash text-blue border-blue/30",
  amber: "bg-amber-wash text-amber border-amber/30",
  red: "bg-red-wash text-red border-red/30",
  ember: "bg-ember-wash text-ember border-ember/30",
};
export const Chip = ({ tone = "neutral", children, dot, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) => (
  <span className={cx("inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap", tones[tone], className)}>
    {dot ? <span className="size-1.5 rounded-full bg-current" /> : null}
    {children}
  </span>
);

/* ---------- forms ---------- */
const control = "w-full rounded-[10px] border border-line-strong bg-void/60 px-3.5 text-ink placeholder:text-ink-3 transition-colors hover:border-ink-3 focus:border-blue focus:outline-none aria-[invalid=true]:border-red disabled:opacity-50";
export function Field({ label, hint, error, optional, children }: { label: string; hint?: ReactNode; error?: string | null; optional?: boolean; children: (p: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode }) {
  const id = useId();
  const describedBy = error ? `${id}-e` : hint ? `${id}-h` : undefined;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 flex items-baseline justify-between text-[13px] font-medium text-ink">
        {label}
        {optional ? <span className="font-normal text-ink-3">Optional</span> : null}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {error ? (
        <p id={`${id}-e`} role="alert" className="mt-1.5 text-[13px] text-red">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-h`} className="mt-1.5 text-[13px] text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(control, "h-11", className)} />;
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(control, "min-h-28 resize-y py-3 leading-relaxed", className)} />;
export const Select = ({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...p} className={cx(control, "h-11 appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 fill=%22none%22 stroke=%22%23b9b1a5%22 stroke-width=%221.5%22><path d=%22m4 6 4 4 4-4%22/></svg>')] bg-[right_12px_center] bg-no-repeat pr-9", className)}>
    {children}
  </select>
);
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }>; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full border border-line-strong bg-void/60 p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)} className={cx("h-8 rounded-full px-3 text-[13px] font-medium transition-colors", value === o.value ? "bg-raised text-ink shadow-[inset_0_1px_0_#ffffff14]" : "text-ink-3 hover:text-ink")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <button id={id} type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={cx("relative mt-0.5 h-6 w-10 shrink-0 rounded-full border transition-colors", checked ? "border-ember bg-ember" : "border-line-strong bg-raised")}>
        <span className={cx("absolute top-0.5 size-[18px] rounded-full transition-all", checked ? "left-[19px] bg-[#1a1206]" : "left-0.5 bg-ink-2")} />
      </button>
      <label htmlFor={id} className="text-sm">
        <span className="font-medium text-ink">{label}</span>
        {hint ? <span className="block text-[13px] text-ink-3">{hint}</span> : null}
      </label>
    </div>
  );
}

/* ---------- dialog ---------- */
export function Dialog({ open, onClose, title, children, footer, width = 480, dismissable = true }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; width?: number; dismissable?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissable) onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current && dismissable) onClose();
      }}
      className="m-auto w-[calc(100vw-24px)] rounded-[20px] border border-line-strong bg-surface p-0 text-ink shadow-[0_30px_120px_#000c,inset_0_1px_0_#ffffff12] max-sm:mb-3"
      style={{ maxWidth: width }}
    >
      <div className="flex items-center justify-between gap-4 px-5 pt-5 sm:px-6">
        <h2 className="text-lg font-semibold">{title}</h2>
        {dismissable ? (
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-full text-ink-3 hover:bg-raised hover:text-ink">
            <Icon name="x" />
          </button>
        ) : null}
      </div>
      <div className="px-5 py-4 sm:px-6">{children}</div>
      {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-4 sm:px-6">{footer}</div> : null}
    </dialog>
  );
}

/* ---------- states: loading, empty, error, no access ---------- */
export const Skeleton = ({ className }: { className?: string }) => <div aria-hidden className={cx("skeleton", className)} />;
export const SkeletonRows = ({ rows = 4 }: { rows?: number }) => (
  <div role="status" aria-label="Loading" className="space-y-3 p-5">
    {Array.from({ length: rows }, (_, i) => (
      <Skeleton key={i} className={cx("h-5", i % 3 === 0 ? "w-2/3" : i % 3 === 1 ? "w-full" : "w-5/6")} />
    ))}
  </div>
);
export function Empty({ title, body, action, icon = "spark" }: { title: string; body?: ReactNode; action?: ReactNode; icon?: string }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="mb-4 grid size-11 place-items-center rounded-full border border-line-strong bg-void text-ember shadow-[0_0_24px_#ffb35a22]">
        <Icon name={icon} size={18} />
      </span>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {body ? <p className="mt-1.5 max-w-[46ch] text-sm text-ink-2">{body}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
export function NoAccess({ what = "this" }: { what?: string }) {
  return <Empty icon="lock" title="Your access doesn't cover this" body={`Ask the founder if you need to see ${what}.`} />;
}
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  if (isApiError(error) && error.status === 403) return <NoAccess />;
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-10 text-center">
      <span className="mb-3 grid size-11 place-items-center rounded-full border border-red/30 bg-red-wash text-red">
        <Icon name="alert" size={18} />
      </span>
      <h3 className="text-base font-semibold">This didn't load</h3>
      <p className="mt-1.5 max-w-[46ch] text-sm text-ink-2">{message}</p>
      {retry ? (
        <Button className="mt-4" icon="refresh" onClick={retry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
/** 501 not_implemented, rendered honestly from details.status / details.replacement. */
export function NotAvailable({ error, title }: { error: unknown; title: string }) {
  const d = isApiError(error) ? (error.details as { status?: string; replacement?: string }) : {};
  return (
    <div className="flex items-start gap-3 rounded-[12px] border border-line bg-void/50 p-4">
      <Icon name="clock" className="mt-0.5 text-ink-3" />
      <div className="text-sm">
        <p className="font-medium text-ink">
          {title}: not available yet <Chip className="ml-1.5 align-middle">{d.status === "planned" ? "Planned" : "Unsupported"}</Chip>
        </p>
        <p className="mt-1 text-ink-2">{isApiError(error) ? error.message : "This feature isn't available yet."}</p>
        {d.replacement ? <p className="mt-1 text-ink-3">Use instead: {d.replacement}</p> : null}
      </div>
    </div>
  );
}
type QueryLike<T> = { data: T | undefined; isPending: boolean; error: unknown; refetch: () => unknown };
/** Every data view goes through the same four states. */
export function Async<T>({ q, children, skeleton, empty }: { q: QueryLike<T>; children: (data: T) => ReactNode; skeleton?: ReactNode; empty?: (data: T) => ReactNode | null | false }) {
  if (q.data === undefined) {
    if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
    return <>{skeleton ?? <SkeletonRows />}</>;
  }
  const e = empty?.(q.data);
  if (e) return <>{e}</>;
  return <>{children(q.data)}</>;
}

/* ---------- small pieces ---------- */
export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "red" | "amber" | "ember" }) {
  return (
    <div className="min-w-0">
      <div className="text-[13px] text-ink-3">{label}</div>
      <div className={cx("num mt-1 truncate text-2xl font-semibold", tone === "red" ? "text-red" : tone === "amber" ? "text-amber" : tone === "ember" ? "text-ember" : "text-ink")}>{value}</div>
      {sub ? <div className="mt-0.5 text-[13px] text-ink-2">{sub}</div> : null}
    </div>
  );
}
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      icon={done ? "check" : "copy"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          /* clipboard blocked */
        }
        setDone(true);
        setTimeout(() => setDone(false), 1600);
      }}
    >
      {done ? "Copied" : label}
    </Button>
  );
}
export const Notice = ({ tone = "blue", children, icon = "alert" }: { tone?: "blue" | "amber" | "red" | "green"; children: ReactNode; icon?: string }) => (
  <div role={tone === "red" ? "alert" : "status"} className={cx("flex items-start gap-2.5 rounded-[12px] border px-3.5 py-3 text-sm", tones[tone])}>
    <Icon name={icon} className="mt-0.5" />
    <div className="min-w-0 text-ink">{children}</div>
  </div>
);
export const Dl = ({ rows }: { rows: Array<[string, ReactNode]> }) => (
  <dl className="divide-y divide-line">
    {rows.map(([k, v]) => (
      <div key={k} className="flex items-baseline justify-between gap-4 py-2.5 text-sm">
        <dt className="shrink-0 text-ink-3">{k}</dt>
        <dd className="min-w-0 text-right break-words text-ink">{v}</dd>
      </div>
    ))}
  </dl>
);

/* ---------- toasts ---------- */
type Toast = { id: number; text: string; tone: "green" | "red" | "neutral" };
const ToastCtx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "neutral") => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-2), { id, text, tone }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6">
        {items.map((t) => (
          <div key={t.id} className="animate-rise pointer-events-auto flex max-w-md items-center gap-2.5 rounded-full border border-line-strong bg-raised px-4 py-2.5 text-sm shadow-[0_12px_40px_#000a]">
            <span className={cx("size-2 rounded-full", t.tone === "green" ? "bg-green" : t.tone === "red" ? "bg-red" : "bg-ember")} />
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
