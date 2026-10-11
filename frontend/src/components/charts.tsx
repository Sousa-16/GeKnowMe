import { useInView } from "../lib/motion";

export interface Segment { key: string; label: string; value: number; color: string }

/** One horizontal bar split into proportional segments, with a clickable legend. */
export function StackedBar({ segments, selected, onSelect }: {
  segments: Segment[]; selected?: string | null; onSelect?: (key: string) => void;
}) {
  const [ref, seenAt] = useInView<HTMLDivElement>();
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div ref={ref}>
      <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
        {segments.map((s, i) => (
          <span key={s.key} title={`${s.label}: ${s.value}`}
            className={`h-full transition-[width] duration-700 ease-out first:rounded-l-full last:rounded-r-full ${s.color} ${selected && selected !== s.key ? "opacity-30" : ""}`}
            style={{ width: seenAt == null ? 0 : `${(s.value / total) * 100}%`, transitionDelay: `${150 + i * 80}ms` }} />
        ))}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
        {segments.map((s) => (
          <li key={s.key}>
            <button type="button" disabled={!onSelect} onClick={() => onSelect?.(s.key)}
              className={`inline-flex items-center gap-1.5 rounded-md px-1 text-slate-600 transition enabled:hover:text-slate-900 ${selected === s.key ? "bg-slate-100 font-medium text-slate-900" : ""}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${s.color}`} />
              {s.label} <span className="tabular-nums text-slate-400">{s.value} · {Math.round((s.value / total) * 100)}%</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface YearBar { year: number; segments: Segment[] }

/** Vertical bars per year, optionally stacked. Bars grow up when scrolled into view. */
export function YearBars({ data, selected, onSelect, height = 120, unit }: {
  data: YearBar[]; selected?: number | null; onSelect?: (year: number) => void; height?: number; unit: string;
}) {
  const [ref, seenAt] = useInView<HTMLDivElement>();
  const max = Math.max(1, ...data.map((d) => d.segments.reduce((s, x) => s + x.value, 0)));
  const step = Math.ceil(data.length / 6);
  return (
    <div ref={ref}>
      <div className="flex items-end gap-[3px]" style={{ height }}>
        {data.map((d, i) => {
          const total = d.segments.reduce((s, x) => s + x.value, 0);
          const dim = selected != null && selected !== d.year;
          return (
            <button key={d.year} type="button" disabled={!onSelect || !total} onClick={() => onSelect?.(d.year)}
              title={`${d.year}: ${total} ${unit}${d.segments.length > 1 ? "\n" + d.segments.filter((s) => s.value).map((s) => `${s.label}: ${s.value}`).join("\n") : ""}`}
              className={`group flex h-full min-w-0 flex-1 flex-col justify-end transition-opacity ${dim ? "opacity-30" : ""}`}>
              <span className="flex w-full flex-col-reverse overflow-hidden rounded-t-[3px] transition-[height] duration-700 ease-out group-enabled:group-hover:brightness-110"
                style={{ height: seenAt == null ? 0 : `${(total / max) * 100}%`, transitionDelay: `${200 + i * 25}ms` }}>
                {d.segments.map((s) => <span key={s.key} className={`w-full shrink-0 ${s.color}`} style={{ height: `${total ? (s.value / total) * 100 : 0}%` }} />)}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-[3px] border-t border-slate-200 pt-1 text-[11px] tabular-nums text-slate-400">
        {data.map((d, i) => <span key={d.year} className="min-w-0 flex-1 text-center">{(i % step === 0 && data.length - 1 - i >= step / 2) || i === data.length - 1 ? `'${String(d.year).slice(2)}` : ""}</span>)}
      </div>
    </div>
  );
}

/** Percentage ring with a label underneath. */
export function Ring({ pct, label, sub, active, onClick, color = "text-brand-500" }: {
  pct: number; label: string; sub: string; active?: boolean; onClick?: () => void; color?: string;
}) {
  const [ref, seenAt] = useInView<HTMLButtonElement>();
  const r = 30, c = 2 * Math.PI * r;
  return (
    <button ref={ref} type="button" onClick={onClick}
      className={`flex flex-col items-center rounded-2xl p-3 text-center transition hover:bg-slate-50 ${active ? "bg-brand-50 ring-1 ring-brand-200" : ""}`}>
      <span className="relative h-20 w-20">
        <svg viewBox="0 0 72 72" className="h-full w-full -rotate-90">
          <circle cx="36" cy="36" r={r} fill="none" strokeWidth="7" className="stroke-slate-100" />
          <circle cx="36" cy="36" r={r} fill="none" strokeWidth="7" strokeLinecap="round" stroke="currentColor"
            className={`${color} transition-[stroke-dashoffset] duration-1000 ease-out`}
            strokeDasharray={c} strokeDashoffset={seenAt == null ? c : c * (1 - pct / 100)} />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-lg font-semibold tabular-nums text-slate-900">{pct}%</span>
      </span>
      <span className="mt-2 text-sm font-medium leading-snug text-slate-800">{label}</span>
      <span className="mt-0.5 text-xs text-slate-500">{sub}</span>
    </button>
  );
}

export interface PyramidLevel { level: number; label: string; count: number }

/** Oxford level 1-5, darkest for the strongest designs. */
const LEVEL_SHADES: Record<number, string> = {
  1: "bg-ink text-white", 2: "bg-pine text-white", 3: "bg-brand-500 text-white", 4: "bg-turquoise text-ink", 5: "bg-alabaster text-ink",
};

/** Oxford CEBM evidence pyramid: strongest designs in the narrow top band. */
export function Pyramid({ levels, selected, onSelect }: {
  levels: PyramidLevel[]; selected: number | null; onSelect: (level: number) => void;
}) {
  const [ref, seenAt] = useInView<HTMLDivElement>();
  return (
    <div ref={ref}>
      {levels.map((l, i) => {
        const top = i * 20, bottom = (i + 1) * 20;
        const dim = selected != null && selected !== l.level;
        return (
          <button key={l.level} type="button" disabled={!l.count} onClick={() => onSelect(l.level)}
            className={`grid h-12 w-full grid-cols-[minmax(0,12rem)_1fr] items-center gap-4 rounded-lg px-1 text-left transition enabled:hover:bg-slate-50 disabled:opacity-40 ${dim ? "opacity-40" : ""}`}>
            <span className="relative flex h-full justify-center">
              <span className={`h-full transition-[width,opacity] duration-700 ease-out ${LEVEL_SHADES[l.level]}`}
                style={{
                  width: seenAt == null ? "0%" : "100%", opacity: seenAt == null ? 0 : 1, transitionDelay: `${i * 90}ms`,
                  clipPath: `polygon(${50 - top / 2}% 0, ${50 + top / 2}% 0, ${50 + bottom / 2}% 100%, ${50 - bottom / 2}% 100%)`,
                }} />
              <span className={`pointer-events-none absolute inset-x-0 flex justify-center text-sm font-semibold tabular-nums ${i === 0 ? "bottom-0" : "inset-y-0 items-center"} ${l.level <= 3 ? "text-white" : "text-ink"}`}>
                {l.count}
              </span>
            </span>
            <span className="min-w-0 text-sm leading-tight">
              <span className="font-medium text-slate-800">Level {l.level}</span>
              <span className="block truncate text-slate-500" title={l.label}>{l.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
