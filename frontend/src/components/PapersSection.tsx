import { useMemo, useState } from "react";
import type { Brief, Paper } from "../types";
import { downloadCsv } from "../lib/csv";
import { nf } from "../lib/format";
import { Badge, Button, DownloadIcon, ExtLink, Section, Select, StatusNote } from "./ui";

const PAGE = 10;
const KEY_TYPES = ["Meta-Analysis", "Systematic Review", "Randomized Controlled Trial", "Clinical Trial, Phase III",
  "Clinical Trial, Phase II", "Clinical Trial, Phase I", "Practice Guideline", "Review", "Case Reports"];

export function PapersSection({ brief }: { brief: Brief }) {
  const { papers, total_count, search_url } = brief.papers;
  const [sort, setSort] = useState<"score" | "year">("score");
  const [aiOnly, setAiOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const l = papers.filter((p) => (!aiOnly || p.sent_to_ai) && (!q || `${p.title} ${p.journal ?? ""} ${p.authors.join(" ")}`.toLowerCase().includes(q)));
    return [...l].sort((a, b) => sort === "score" ? b.score - a.score : (b.year ?? 0) - (a.year ?? 0));
  }, [papers, sort, aiOnly, query]);

  const exportCsv = () => downloadCsv(`${brief.rsid}-papers.csv`,
    ["pmid", "title", "journal", "year", "authors", "publication_types", "score", "score_reasons", "sent_to_ai", "url"],
    list.map((p) => [p.pmid, p.title, p.journal, p.year, p.authors.join("; "), p.publication_types.join("; "), p.score, p.score_reasons.join("; "), p.sent_to_ai, p.url]));

  return (
    <Section id="papers" title="Publications"
      subtitle={papers.length ? <>{papers.length} papers ranked by evidence level (Oxford CEBM) and relevance
        {total_count ? <> · {nf.format(total_count)} mention this variant in total</> : null}
        {search_url && <> · <ExtLink href={search_url}>open the search on PubMed</ExtLink></>}</> : undefined}
      actions={papers.length > 0 && <Button onClick={exportCsv}><DownloadIcon />Papers CSV</Button>}>
      {!papers.length ? <StatusNote status={brief.status.papers ?? "skipped"} emptyText="No papers found for this variant." warnings={brief.warnings.filter((w) => w.startsWith("paper"))} /> : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }} placeholder="Filter by title, journal, author…"
              className="min-w-0 flex-1 rounded-lg border-0 py-1.5 pl-3 text-sm shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-brand-600 sm:max-w-xs" />
            <Select label="Sort" value={sort} onChange={(v) => setSort(v as typeof sort)} options={[{ value: "score", label: "Evidence score" }, { value: "year", label: "Newest" }]} />
            <label className="inline-flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={aiOnly} onChange={(e) => { setAiOnly(e.target.checked); setLimit(PAGE); }} className="rounded border-slate-300 text-brand-600 focus:ring-brand-600" />
              Sent to AI only
            </label>
            <span className="ml-auto text-sm text-slate-500">{list.length} papers</span>
          </div>
          <ul className="mt-3 space-y-2">
            {list.slice(0, limit).map((p) => <PaperItem key={p.pmid} p={p} />)}
          </ul>
          {list.length > limit && <div className="mt-3 text-center"><Button onClick={() => setLimit(limit + PAGE)}>Show more</Button></div>}
        </>
      )}
    </Section>
  );
}

function PaperItem({ p }: { p: Paper }) {
  const [open, setOpen] = useState(false);
  const types = p.publication_types.filter((t) => KEY_TYPES.includes(t));
  return (
    <li className="rounded-xl p-3 ring-1 ring-slate-200">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <ExtLink href={p.url} className="text-sm font-medium !text-slate-900 !no-underline hover:!text-brand-800">{p.title}</ExtLink>
          <p className="mt-0.5 text-xs text-slate-500">
            {[p.authors.slice(0, 3).join(", ") + (p.authors.length > 3 ? " et al." : ""), p.journal, p.year].filter(Boolean).join(" · ")}
            {" · "}<span className="font-mono">PMID {p.pmid}</span>
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {types.map((t) => <Badge key={t} tone={/Random|Phase III|Meta|Systematic/.test(t) ? "green" : /Clinical Trial/.test(t) ? "blue" : "slate"}>{t}</Badge>)}
            {p.sent_to_ai && <Badge tone="amber" title="One of the top papers sent to the AI treatment summary">Sent to AI</Badge>}
            {p.abstract && <button type="button" onClick={() => setOpen(!open)} className="text-xs font-medium text-brand-700 hover:text-brand-800">{open ? "Hide abstract" : "Abstract"}</button>}
          </div>
        </div>
        <span className="shrink-0 text-xs text-slate-500" title={p.score_reasons.join("\n") || "Not scored"}>
          score <span className="font-semibold tabular-nums text-slate-700">{p.score}</span>
        </span>
      </div>
      {open && <p className="mt-2 whitespace-pre-line rounded-lg bg-slate-50 p-3 text-sm leading-relaxed text-slate-600">{p.abstract}</p>}
    </li>
  );
}
