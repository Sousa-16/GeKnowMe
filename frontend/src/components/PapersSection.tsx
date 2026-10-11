import { useMemo, useState } from "react";
import type { Brief, Paper } from "../types";
import { downloadCsv } from "../lib/csv";
import { nf } from "../lib/format";
import { Pyramid, YearBars, type YearBar } from "./charts";
import { OCEBM } from "./TreatmentsSection";
import { Badge, Button, DownloadIcon, Eyebrow, ExtLink, Highlighted, Section, Select, StatusNote, variantTerms } from "./ui";

const PAGE = 10;
const KEY_TYPES = ["Meta-Analysis", "Systematic Review", "Randomized Controlled Trial", "Clinical Trial, Phase III",
  "Clinical Trial, Phase II", "Clinical Trial, Phase I", "Practice Guideline", "Review", "Case Reports"];
const PYRAMID_LABEL: Record<number, string> = {
  1: "Systematic reviews", 2: "Randomized trials", 3: "Observational studies", 4: "Case series & reports", 5: "Lab or animal only",
};

/** Oxford level the backend scored the paper at, read back from its score reasons. */
const levelOf = (p: Paper) => { const m = p.score_reasons.join(" ").match(/OCEBM level (\d)/); return m ? Number(m[1]) : null; };

export function PapersSection({ brief }: { brief: Brief }) {
  const { papers, total_count, search_url } = brief.papers;
  const terms = useMemo(() => variantTerms(brief), [brief]);
  const [sort, setSort] = useState<"score" | "year">("score");
  const [aiOnly, setAiOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<number | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [limit, setLimit] = useState(PAGE);

  const levels = useMemo(() => [1, 2, 3, 4, 5].map((l) => ({ level: l, label: PYRAMID_LABEL[l], count: papers.filter((p) => levelOf(p) === l).length })), [papers]);
  const unranked = papers.length - levels.reduce((s, l) => s + l.count, 0);
  const byYear = useMemo<YearBar[]>(() => {
    const ys = papers.map((p) => p.year).filter((y): y is number => y != null);
    if (!ys.length) return [];
    const out: YearBar[] = [];
    for (let y = Math.min(...ys); y <= Math.max(...ys); y++) {
      out.push({ year: y, segments: [{ key: "papers", label: "Publications", color: "bg-pine", value: papers.filter((p) => p.year === y).length }] });
    }
    return out;
  }, [papers]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const l = papers.filter((p) => (!aiOnly || p.sent_to_ai) && (level == null || levelOf(p) === level) && (year == null || p.year === year) &&
      (!q || `${p.title} ${p.journal ?? ""} ${p.authors.join(" ")}`.toLowerCase().includes(q)));
    return [...l].sort((a, b) => sort === "score" ? b.score - a.score : (b.year ?? 0) - (a.year ?? 0));
  }, [papers, sort, aiOnly, query, level, year]);
  const filtersOn = aiOnly || query || level != null || year != null;

  const exportCsv = () => downloadCsv(`${brief.rsid}-papers.csv`,
    ["pmid", "title", "journal", "year", "authors", "publication_types", "score", "score_reasons", "sent_to_ai", "url"],
    list.map((p) => [p.pmid, p.title, p.journal, p.year, p.authors.join("; "), p.publication_types.join("; "), p.score, p.score_reasons.join("; "), p.sent_to_ai, p.url]));

  return (
    <Section id="papers" title="Publications" icon="book" accent="alabaster"
      subtitle={papers.length ? <>{papers.length} papers ranked by evidence level (Oxford CEBM) and relevance
        {total_count ? <> · {nf.format(total_count)} mention this variant in total</> : null}
        {search_url && <> · <ExtLink href={search_url}>open the search on PubMed</ExtLink></>}</> : undefined}
      actions={papers.length > 0 && <Button onClick={exportCsv}><DownloadIcon />Papers CSV</Button>}>
      {!papers.length ? <StatusNote status={brief.status.papers ?? "skipped"} emptyText="No papers found for this variant." warnings={brief.warnings.filter((w) => w.startsWith("paper"))} /> : (
        <div className="space-y-8">
          <div className="grid gap-8 md:grid-cols-2 [&>*]:min-w-0">
            <div>
              <Eyebrow>Evidence pyramid · strongest study designs at the top</Eyebrow>
              <Pyramid levels={levels} selected={level} onSelect={(l) => { setLevel(level === l ? null : l); setLimit(PAGE); }} />
              {unranked > 0 && <p className="mt-2 text-xs text-slate-400">{unranked} papers (e.g. narrative reviews) have no rankable study design.</p>}
            </div>
            {byYear.length > 1 && (
              <div>
                <Eyebrow>Papers per year</Eyebrow>
                <YearBars data={byYear} unit="papers" height={150} selected={year} onSelect={(y) => { setYear(year === y ? null : y); setLimit(PAGE); }} />
              </div>
            )}
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-5 print:hidden">
              <input value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }} placeholder="Filter by title, journal, author…"
                className="min-w-0 flex-1 rounded-lg border-0 py-1.5 pl-3 text-sm shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-brand-600 sm:max-w-xs" />
              <Select label="Sort" value={sort} onChange={(v) => setSort(v as typeof sort)} options={[{ value: "score", label: "Evidence score" }, { value: "year", label: "Newest" }]} />
              <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={aiOnly} onChange={(e) => { setAiOnly(e.target.checked); setLimit(PAGE); }} className="rounded border-slate-300 text-brand-600 focus:ring-brand-600" />
                Sent to AI only
              </label>
              {filtersOn && <Button variant="ghost" onClick={() => { setAiOnly(false); setQuery(""); setLevel(null); setYear(null); setLimit(PAGE); }}>Clear filters</Button>}
              <span className="ml-auto text-sm text-slate-500">
                {list.length} papers{level != null ? ` at level ${level}` : ""}{year != null ? ` from ${year}` : ""}
              </span>
            </div>
            <ul className="mt-3 space-y-3">
              {list.slice(0, limit).map((p) => <PaperItem key={p.pmid} p={p} terms={terms} />)}
              {!list.length && <li className="rounded-xl px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-200">No papers match these filters.</li>}
            </ul>
            {list.length > limit && <div className="mt-3 text-center print:hidden"><Button onClick={() => setLimit(limit + PAGE)}>Show more</Button></div>}
          </div>
        </div>
      )}
    </Section>
  );
}

function PaperItem({ p, terms }: { p: Paper; terms: string[] }) {
  const [open, setOpen] = useState(false);
  const types = p.publication_types.filter((t) => KEY_TYPES.includes(t)).slice(0, 2);
  const level = levelOf(p);
  return (
    <li className="flex gap-4 rounded-xl bg-white p-4 ring-1 ring-slate-200 transition hover:ring-slate-300">
      <div className="hidden w-16 shrink-0 flex-col items-center gap-2 border-r border-slate-100 pr-4 sm:flex">
        <span className="font-serif text-3xl leading-none text-slate-800">{p.year ?? "—"}</span>
        {level != null && <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500" title={`Oxford level ${level}: ${OCEBM[level]}`}>Level {level}</span>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-3">
          <a href={p.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 font-medium leading-snug text-slate-900 hover:text-brand-800">
            <Highlighted text={p.title} terms={terms} />
          </a>
          <span className="shrink-0 text-xs text-slate-500" title={p.score_reasons.join("\n") || "Not scored"}>
            score <span className="font-semibold tabular-nums text-slate-700">{p.score}</span>
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {[p.authors.slice(0, 3).join(", ") + (p.authors.length > 3 ? " et al." : ""), p.journal].filter(Boolean).join(" · ")}
          <span className="sm:hidden">{p.year ? ` · ${p.year}` : ""}</span>
          {" · "}<span className="font-mono text-xs">PMID {p.pmid}</span>
        </p>
        {(types.length > 0 || p.sent_to_ai) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {level != null && <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500 sm:hidden">Level {level}</span>}
            {types.map((t) => <Badge key={t} tone={/Random|Phase III|Meta|Systematic/.test(t) ? "pine" : /Clinical Trial/.test(t) ? "turquoise" : "slate"}>{t}</Badge>)}
            {p.sent_to_ai && <Badge tone="pine" title="One of the top papers sent to the AI treatment summary">Sent to AI</Badge>}
          </div>
        )}
        {p.abstract && (
          <div className="mt-3">
            <p className={`max-w-prose whitespace-pre-line text-sm leading-relaxed text-slate-600 ${open ? "" : "line-clamp-2 [mask-image:linear-gradient(to_bottom,black_55%,transparent)]"}`}>
              <Highlighted text={p.abstract} terms={terms} />
            </p>
            <button type="button" onClick={() => setOpen(!open)} className="mt-1 text-xs font-semibold text-brand-700 hover:text-brand-800 print:hidden">
              {open ? "Show less" : "Read abstract"}
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
