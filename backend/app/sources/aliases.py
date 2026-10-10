"""[2] Aliases - Person A. See docs/PLAN.md section 5, step 2.

No internet needed. Turns the raw names from step 1 into every name the mutation goes by
("p.Val600Glu" -> "V600E"), each with a note on where it came from, plus the search terms
that steps 3 and 4 use.
"""

import re

from ..schemas import Alias, Aliases, Variant

# A7: 3-letter -> 1-letter amino acids (IUPAC), plus the stop codon (A8)
AMINO_ACIDS = {
    "Ala": "A", "Arg": "R", "Asn": "N", "Asp": "D", "Cys": "C", "Gln": "Q", "Glu": "E", "Gly": "G",
    "His": "H", "Ile": "I", "Leu": "L", "Lys": "K", "Met": "M", "Phe": "F", "Pro": "P", "Ser": "S",
    "Thr": "T", "Trp": "W", "Tyr": "Y", "Val": "V", "Sec": "U", "Pyl": "O", "Xaa": "X",
    "Ter": "*",
}
_ONE_LETTER = set(AMINO_ACIDS.values())

# "p.Val600Glu", "p.(Val600Glu)", "p.Val600Ter", "p.Val600*" and already-short "p.V600E" / "V600E"
_SUBSTITUTION = re.compile(
    r"^(?:p\.)?\(?([A-Z][a-z]{2}|[A-Z*])(\d+)([A-Z][a-z]{2}|[A-Z*])\)?$"
)
_SHORT = re.compile(r"^([A-Z])(\d+)([A-Z*])$")
_CODON = re.compile(r"^([A-Z]\d+)")


def short_protein(hgvs_p: str) -> str | None:
    """'p.Val600Glu' -> 'V600E', 'p.Val600Ter' -> 'V600*'. None for anything that isn't a simple
    substitution (deletions, frameshifts, 'p.?', synonymous 'p.Val600=' ...)."""
    m = _SUBSTITUTION.match((hgvs_p or "").strip())
    if not m:
        return None
    ref, pos, alt = m.groups()
    ref1 = AMINO_ACIDS.get(ref, ref if ref in _ONE_LETTER else None)
    alt1 = AMINO_ACIDS.get(alt, alt if alt in _ONE_LETTER else None)
    if not ref1 or not alt1 or ref1 == "*":
        return None
    return f"{ref1}{pos}{alt1}"


_OTHER = re.compile(
    r"^(?:p\.)?\(?([A-Z][a-z]{2}|[A-Z])(\d+)(?:_([A-Z][a-z]{2}|[A-Z])(\d+))?"
    r"(delins[A-Za-z*]+|del|dup|ins[A-Za-z*]+|[A-Z][a-z]{2}fs.*|[A-Z]fs.*|fs.*)\)?$"
)


def _one(aa: str) -> str | None:
    return AMINO_ACIDS.get(aa, aa if aa in _ONE_LETTER else None)


def _seq_one(seq: str) -> str | None:
    """'GluLys' -> 'EK'."""
    parts = re.findall(r"[A-Z][a-z]{2}|[A-Z*]", seq)
    out = [_one(x) for x in parts]
    return "".join(out) if parts and all(out) and "".join(parts) == seq else None


def short_other(hgvs_p: str) -> str | None:
    """Short names for deletions, duplications, insertions and frameshifts, the way papers and
    trials write them: 'p.Phe508del' -> 'F508del', 'p.Glu746_Ala750del' -> 'E746_A750del',
    'p.Gln1756ProfsTer74' -> 'Q1756fs'. None for anything else."""
    m = _OTHER.match((hgvs_p or "").strip())
    if not m:
        return None
    a, p, b, q, kind = m.groups()
    a1, b1 = _one(a), (_one(b) if b else None)
    if not a1 or (b and not b1):
        return None
    span = f"{a1}{p}" + (f"_{b1}{q}" if b else "")
    if "fs" in kind:
        return f"{a1}{p}fs"
    if kind in ("del", "dup"):
        return span + kind
    for prefix in ("delins", "ins"):
        if kind.startswith(prefix):
            seq = _seq_one(kind[len(prefix):])
            return f"{span}{prefix}{seq}" if seq else None
    return None


# Well-known nicknames that trials and papers use instead of HGVS names, and that can't be derived
# from the HGVS name (different numbering conventions or historical names). Only rs numbers whose
# nickname is unambiguous are listed.
NICKNAMES: dict[str, list[str]] = {
    "rs429358": ["APOE4", "APOE ε4"],
    "rs7412": ["APOE2", "APOE ε2"],
    "rs6025": ["Factor V Leiden"],
    "rs334": ["sickle cell"],
    "rs1799963": ["prothrombin G20210A"],
    "rs1801133": ["MTHFR C677T"],
    "rs1801131": ["MTHFR A1298C"],
    "rs113993960": ["F508del"],
    "rs76763715": ["GBA N370S"],
    "rs80357906": ["BRCA1 5382insC"],
}
_C_SUBST = re.compile(r"^c\.(\d+)([ACGT])>([ACGT])$")


def literature_forms(name: str) -> list[str]:
    """Search forms of a LitVar literature name: 'p.C130R' -> ['C130R'], 'c.677C>T' -> ['C677T'],
    'p.F508del' -> ['F508del']. Anything else is kept as written ('c.5266dupC')."""
    short = short_protein(name) or short_other(name)
    if short:
        return [short]
    if m := _C_SUBST.match(name):
        return [f"{m.group(2)}{m.group(1)}{m.group(3)}"]  # the classic shorthand, e.g. MTHFR C677T
    return [name.strip()] if name.strip() else []


def long_protein(short: str) -> str | None:
    """'V600E' -> 'Val600Glu' (used for PubMed terms like "BRAF Val600Glu")."""
    m = _SHORT.match(short or "")
    if not m:
        return None
    back = {v: k for k, v in AMINO_ACIDS.items()}
    ref, pos, alt = m.groups()
    if ref not in back or alt not in back:
        return None
    return f"{back[ref]}{pos}{back[alt]}"


def codon(short: str) -> str | None:
    """'V600E' -> 'V600': the codon-level name trials often use ("BRAF V600 mutation")."""
    m = _CODON.match(short or "")
    return m.group(1) if m else None


# ---------- A9: the alias list ----------

def build_alias_list(variant: Variant) -> list[Alias]:
    """One Alias per name. variant.hgvs_p already lists the best-studied allele first (step 1
    orders by CIViC/ClinVar evidence), so V600E comes before V600A/V600G."""
    names: list[Alias] = [Alias(name=variant.rsid, type="rsid", derived_from="input")]
    seen = {variant.rsid}

    def add(name: str, type_: str, derived_from: str):
        if name and name not in seen:
            seen.add(name)
            names.append(Alias(name=name, type=type_, derived_from=derived_from))

    for p in variant.hgvs_p:
        add(p, "protein_long", "MyVariant")
        short = short_protein(p) or short_other(p)
        if short:
            add(short, "protein_short", f"converted from {p} (MyVariant)")
    for c in variant.hgvs_c:
        add(c, "dna", "MyVariant")
    for lit in variant.literature_names:
        for form in literature_forms(lit):
            add(form, "common", f"name used in the literature: {lit} (LitVar2, NCBI)")
    for nick in NICKNAMES.get(variant.rsid, []):
        add(nick, "common", "curated nickname used in trials and papers")
    return names


# ---------- A10: search terms ----------

def build_pubmed_terms(gene: str | None, names: list[Alias]) -> list[str]:
    """Quoted phrases for PubMed: "BRAF V600E", "BRAF p.V600E", "BRAF Val600Glu", then the rs
    number. Without a gene the mutation name alone is too ambiguous, so only the rs number."""
    terms: list[str] = []
    if gene:
        for a in names:
            if a.type != "protein_short":
                continue
            for form in (a.name, f"p.{a.name}", long_protein(a.name)):
                if form:
                    terms.append(f'"{gene} {form}"')
    nicknames = set(NICKNAMES.get(next((a.name for a in names if a.type == "rsid"), ""), []))
    for a in names:
        if a.type == "common":
            terms.append(f'"{a.name}"' if a.name in nicknames or not gene else f'"{gene} {a.name}"')
    terms += [a.name for a in names if a.type == "rsid"]
    return list(dict.fromkeys(terms))


def build_trial_terms(gene: str | None, names: list[Alias]) -> list[str]:
    """Plain phrases for ClinicalTrials.gov: one per mutation ("BRAF V600E") plus the codon-level
    form ("BRAF V600"), which many trials use. ClinicalTrials.gov can't search by rs number."""
    shorts = [a.name for a in names if a.type == "protein_short"]
    prefix = f"{gene} " if gene else ""
    terms = [f"{prefix}{s}" for s in shorts]
    terms += [f"{prefix}{c}" for s in shorts if (c := codon(s))]
    return list(dict.fromkeys(terms))


def build_extra_trial_terms(variant: Variant, names: list[Alias], trial_terms: list[str]) -> list[str]:
    """Nicknames ("Factor V Leiden"), literature names with the gene ("MTHFR C677T") and the rs number,
    which some trial records mention. Searched alongside trial_terms."""
    nicknames = NICKNAMES.get(variant.rsid, [])
    terms = list(nicknames)
    for a in names:
        if a.type == "common" and a.name not in nicknames and variant.gene and " " not in a.name:
            terms.append(f"{variant.gene} {a.name}")
    terms.append(variant.rsid)
    return [t for t in dict.fromkeys(terms) if t not in trial_terms]


_GENERIC_CONDITIONS = re.compile(r"not provided|not specified|see cases|^none$|^other$|multiple|inborn genetic diseases",
                                 re.IGNORECASE)


def build_fallback_trial_terms(variant: Variant) -> list[str]:
    """Disease-level searches ("HBB Sickle cell anemia") from the conditions ClinVar links to this
    variant. Used only when the variant searches find few trials; those trials are marked as
    disease-level matches."""
    if not variant.gene:
        return []
    counts: dict[str, int] = {}
    for r in variant.clinvar_records:
        if not re.search(r"pathogenic|risk|drug|affects|association", r.significance, re.IGNORECASE):
            continue
        if re.search(r"benign|conflicting|uncertain", r.significance, re.IGNORECASE):
            continue
        for cond in r.condition.split(";"):
            cond = cond.strip()
            if cond and not _GENERIC_CONDITIONS.search(cond):
                counts[cond] = counts.get(cond, 0) + 1
    top = sorted(counts, key=lambda c: -counts[c])[:2]
    return [f"{variant.gene} {c}" for c in top]


def build_aliases(variant: Variant) -> Aliases:
    names = build_alias_list(variant)
    trial_terms = build_trial_terms(variant.gene, names)
    return Aliases(
        gene=variant.gene,
        names=names,
        pubmed_terms=build_pubmed_terms(variant.gene, names),
        trial_terms=trial_terms,
        extra_trial_terms=build_extra_trial_terms(variant, names, trial_terms),
        fallback_trial_terms=build_fallback_trial_terms(variant),
    )
