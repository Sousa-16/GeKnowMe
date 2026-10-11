import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Brief, SectionStatus } from "../types";
import { nf } from "../lib/format";
import { splitHighlights } from "../lib/highlight";
import { useCountUp, useInView } from "../lib/motion";
import { Icon, type IconName } from "./icons";

/** Palette tones; `shadow` (outlined) marks warnings. */
export type Tone = "turquoise" | "pine" | "ink" | "slate" | "shadow";

export const TONES: Record<Tone, string> = {
  turquoise: "bg-turquoise/25 text-brand-900 ring-turquoise",
  pine: "bg-brand-50 text-pine ring-pine/30",
  ink: "bg-ink text-white ring-ink",
  slate: "bg-slate-100 text-slate-700 ring-slate-400/30",
  shadow: "bg-white text-shadow ring-shadow/50",
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

export type Accent = "pine" | "turquoise" | "ink" | "shadow" | "alabaster";

/** One palette color per brief section, shared by the section header and the sidebar. */
export const ACCENTS: Record<Accent, { chip: string; dot: string }> = {
  pine: { chip: "bg-pine text-white ring-pine", dot: "bg-pine" },
  turquoise: { chip: "bg-turquoise text-ink ring-turquoise", dot: "bg-turquoise" },
  ink: { chip: "bg-ink text-turquoise ring-ink", dot: "bg-ink" },
  shadow: { chip: "bg-shadow text-white ring-shadow", dot: "bg-shadow" },
  alabaster: { chip: "bg-alabaster text-pine ring-slate-300", dot: "bg-slate-400" },
};

/** Bumping `signal` tells every Section to adopt `open` (the "Collapse all / Expand all" control). */
export const CollapseContext = createContext({ signal: 0, open: true });

export function Section({ id, title, subtitle, actions, children, accent = "pine", icon }: {
  id: string; title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; accent?: Accent; icon?: IconName;
}) {
  const all = useContext(CollapseContext);
  const [open, setOpen] = useState(true);
  const [signal, setSignal] = useState(all.signal);
  if (signal !== all.signal) { setSignal(all.signal); setOpen(all.open); }
  useEffect(() => {
    const onHash = () => { if (window.location.hash === `#${id}`) setOpen(true); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [id]);
  const a = ACCENTS[accent];

  return (
    <section id={id} className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 transition-shadow duration-300 hover:shadow-md print:break-before-auto print:shadow-none">
      <header className={`flex flex-wrap items-start justify-between gap-3 px-6 py-5 ${open ? "border-b border-slate-100" : ""}`}>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="group flex min-w-0 flex-1 items-start gap-3 text-left">
          {icon && <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${a.chip}`}><Icon name={icon} className="h-5 w-5" /></span>}
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <h2 className="font-serif text-[1.7rem] leading-tight text-slate-900">{title}</h2>
              <Icon name="chevron" className={`h-5 w-5 text-slate-400 transition-transform duration-300 group-hover:text-slate-600 print:hidden ${open ? "" : "-rotate-90"}`} />
            </span>
            {subtitle && <span className="mt-1 block max-w-3xl text-sm leading-relaxed text-slate-500">{subtitle}</span>}
          </span>
        </button>
        {actions && open && <div className="flex flex-wrap items-center gap-2 print:hidden">{actions}</div>}
      </header>
      <div inert={!open} className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out print:grid-rows-[1fr] print:opacity-100 ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
        <div className="min-h-0 overflow-hidden"><div className="p-6">{children}</div></div>
      </div>
    </section>
  );
}

const STATUS_TEXT: Record<SectionStatus, { text: string; hint: string; icon: IconName }> = {
  ok: { text: "", hint: "", icon: "check" },
  empty: { text: "Nothing found for this variant.", hint: "Try one of its other names in the search box, or check back later as new records are added.", icon: "search" },
  error: { text: "This source is unavailable right now.", hint: "The rest of the brief still works. Reload the page in a minute to try again.", icon: "alert" },
  skipped: { text: "This step isn't available yet.", hint: "It needs an earlier step that didn't return data for this variant.", icon: "layers" },
  pending: { text: "Loading…", hint: "", icon: "clock" },
};

/** Shown instead of section content when the backend marks the section as not ok. */
export function StatusNote({ status, warnings = [], emptyText }: { status?: SectionStatus; warnings?: string[]; emptyText?: string }) {
  if (!status || status === "ok") return null;
  const s = STATUS_TEXT[status];
  const error = status === "error";
  return (
    <div className={`flex items-start gap-4 rounded-xl border px-5 py-4 text-sm ${error ? "border-shadow/30 bg-white" : "border-dashed border-slate-300 bg-slate-50/70"}`}>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${error ? "bg-shadow text-white" : "bg-white text-slate-400 ring-1 ring-slate-200"}`}>
        <Icon name={s.icon} className="h-5 w-5" />
      </span>
      <div>
        <p className="font-medium text-slate-800">{status === "empty" && emptyText ? emptyText : s.text}</p>
        {s.hint && <p className="mt-0.5 text-slate-500">{s.hint}</p>}
        {warnings.map((w) => <p key={w} className="mt-1.5 font-mono text-xs text-slate-500">{w}</p>)}
      </div>
    </div>
  );
}

/** Horizontal bars: label, bar, count. Optional link per row (e.g. the matching ClinicalTrials.gov search). */
export function BarList({ items, tone = "bg-brand-500", onSelect, selected }: {
  items: { label: string; value: number; hint?: string }[]; tone?: string;
  onSelect?: (label: string) => void; selected?: string | null;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const [ref, seenAt] = useInView<HTMLUListElement>();
  return (
    <ul ref={ref} className="space-y-1.5">
      {items.map((i, idx) => {
        const active = selected === i.label;
        const inner = (
          <>
            <span className="w-36 shrink-0 truncate text-left text-sm text-slate-600" title={i.label}>{i.label}</span>
            <span className="relative h-5 flex-1 rounded bg-slate-100">
              <span className={`absolute inset-y-0 left-0 rounded transition-[width] duration-700 ease-out ${tone} ${active ? "opacity-100" : "opacity-80"}`}
                style={{ width: seenAt == null ? 0 : `${(i.value / max) * 100}%`, transitionDelay: `${250 + idx * 60}ms` }} />
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

export function Kpi({ label, value, hint, href, delay = 0, glow = false }: {
  label: string; value: ReactNode; hint?: ReactNode; href?: string; delay?: number; glow?: boolean;
}) {
  const body = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </>
  );
  const cls = `block rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 ${glow ? "animate-glow" : "animate-fade-up"}`;
  const style = { animationDelay: glow ? undefined : `${delay}ms` };
  return href
    ? <a href={href} style={style} className={`${cls} transition duration-200 hover:-translate-y-0.5 hover:shadow-md hover:ring-brand-300`}>{body}</a>
    : <div style={style} className={cls}>{body}</div>;
}

export function CountUp({ value }: { value: number }) {
  return <>{nf.format(useCountUp(value))}</>;
}

/** Fades its content up the first time it scrolls into view. `delay` only applies to content
 * visible right after mount, so the first screen staggers in but later sections don't lag. */
export function Reveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const [ref, seenAt] = useInView<HTMLDivElement>();
  const [mountedAt] = useState(() => performance.now());
  const wait = seenAt != null && seenAt - mountedAt < 600 ? delay : 0;
  return (
    <div ref={ref} className={`print:opacity-100 ${seenAt == null ? "opacity-0" : "animate-fade-up"}`} style={{ animationDelay: `${wait}ms` }}>
      {children}
    </div>
  );
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

/** Copies `text` and reports `true` for a moment afterwards, for "Copied" feedback. */
export function useCopy(ms = 1400): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), ms);
    return () => clearTimeout(t);
  }, [copied, ms]);
  return [copied, (text) => { void navigator.clipboard?.writeText(text).then(() => setCopied(true)); }];
}

/** Text with the variant's names (and optional keywords) picked out. */
export function Highlighted({ text, terms, keywords }: { text: string; terms: string[]; keywords?: string[] }) {
  const pieces = useMemo(() => splitHighlights(text, terms, keywords), [text, terms, keywords]);
  return <>{pieces.map((p, i) => p.kind === "term"
    ? <span key={i} className="rounded bg-brand-100 px-0.5 font-medium text-brand-900">{p.text}</span>
    : p.kind === "keyword"
      ? <span key={i} className="font-medium text-slate-900 underline decoration-turquoise decoration-2 underline-offset-2">{p.text}</span>
      : p.text)}</>;
}

/** Every name the variant goes by, plus its gene: what Highlighted should pick out. */
export function variantTerms(brief: Brief): string[] {
  const names = (brief.aliases?.names ?? []).filter((n) => n.type !== "rsid").map((n) => n.name);
  const gene = brief.aliases?.gene ?? brief.variant?.gene;
  return gene ? [...names, gene] : names;
}

/** Uppercase label above a chart or list inside a section. */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500 ${className}`}>{children}</p>;
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
