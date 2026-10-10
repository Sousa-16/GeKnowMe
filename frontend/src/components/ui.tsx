import type { ReactNode } from "react";
import type { SectionStatus } from "../types";

type Tone = "green" | "blue" | "slate" | "red" | "amber" | "brand" | "violet";

const TONES: Record<Tone, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  blue: "bg-sky-50 text-sky-700 ring-sky-600/20",
  slate: "bg-slate-100 text-slate-700 ring-slate-500/20",
  red: "bg-rose-50 text-rose-700 ring-rose-600/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/25",
  brand: "bg-brand-50 text-brand-800 ring-brand-600/25",
  violet: "bg-violet-50 text-violet-700 ring-violet-600/20",
};

export function Badge({ tone = "slate", children, title, mono }: { tone?: Tone; children: ReactNode; title?: string; mono?: boolean }) {
  return (
    <span title={title}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]} ${mono ? "font-mono" : ""}`}>
      {children}
    </span>
  );
}

export function ExtLink({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className={`text-brand-700 underline decoration-brand-200 underline-offset-2 hover:decoration-brand-600 ${className}`}>
      {children}
    </a>
  );
}

export function Button({ children, onClick, variant = "secondary", disabled, title }: {
  children: ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "ghost"; disabled?: boolean; title?: string;
}) {
  const styles = {
    primary: "bg-brand-700 text-white hover:bg-brand-800 shadow-sm",
    secondary: "bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 shadow-sm",
    ghost: "text-slate-600 hover:bg-slate-100",
  }[variant];
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${styles}`}>
      {children}
    </button>
  );
}

export function Section({ id, title, subtitle, actions, children }: {
  id: string; title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode;
}) {
  return (
    <section id={id} className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

const STATUS_TEXT: Record<SectionStatus, string> = {
  ok: "",
  empty: "Nothing found for this variant.",
  error: "This source is unavailable right now.",
  skipped: "This step isn't available yet.",
  pending: "Loading…",
};

/** Shown instead of section content when the backend marks the section as not ok. */
export function StatusNote({ status, warnings = [], emptyText }: { status?: SectionStatus; warnings?: string[]; emptyText?: string }) {
  if (!status || status === "ok") return null;
  const tone = status === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-slate-200 bg-slate-50 text-slate-600";
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${tone}`}>
      <p className="font-medium">{status === "empty" && emptyText ? emptyText : STATUS_TEXT[status]}</p>
      {warnings.map((w) => <p key={w} className="mt-1 text-xs opacity-80">{w}</p>)}
    </div>
  );
}

/** Horizontal bars: label, bar, count. Optional link per row (e.g. the matching ClinicalTrials.gov search). */
export function BarList({ items, tone = "bg-brand-500", onSelect, selected }: {
  items: { label: string; value: number; hint?: string }[]; tone?: string;
  onSelect?: (label: string) => void; selected?: string | null;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-1.5">
      {items.map((i) => {
        const active = selected === i.label;
        const inner = (
          <>
            <span className="w-36 shrink-0 truncate text-left text-sm text-slate-600" title={i.label}>{i.label}</span>
            <span className="relative h-5 flex-1 rounded bg-slate-100">
              <span className={`absolute inset-y-0 left-0 rounded ${tone} ${active ? "opacity-100" : "opacity-80"}`} style={{ width: `${(i.value / max) * 100}%` }} />
            </span>
            <span className="w-10 shrink-0 text-right text-sm font-medium tabular-nums text-slate-700">{i.value}</span>
          </>
        );
        return (
          <li key={i.label} title={i.hint}>
            {onSelect ? (
              <button type="button" onClick={() => onSelect(i.label)}
                className={`flex w-full items-center gap-3 rounded-md px-1 py-0.5 transition hover:bg-slate-50 ${active ? "bg-brand-50 ring-1 ring-brand-200" : ""}`}>
                {inner}
              </button>
            ) : <div className="flex items-center gap-3 px-1 py-0.5">{inner}</div>}
          </li>
        );
      })}
    </ul>
  );
}

export function Kpi({ label, value, hint, href }: { label: string; value: ReactNode; hint?: ReactNode; href?: string }) {
  const body = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </>
  );
  return href
    ? <a href={href} className="block rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 transition hover:ring-brand-300">{body}</a>
    : <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">{body}</div>;
}

export function Select({ value, onChange, options, label }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; label: string;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-slate-600">
      <span className="sr-only sm:not-sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border-0 bg-white py-1.5 pl-2.5 pr-8 text-sm text-slate-700 shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-600">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin text-brand-600 ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-20" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function DownloadIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.69L6.28 8.47a.75.75 0 1 0-1.06 1.06l4.25 4.25a.75.75 0 0 0 1.06 0l4.25-4.25a.75.75 0 1 0-1.06-1.06l-2.97 2.97V2.75Z" />
      <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
    </svg>
  );
}
