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
        short = short_protein(p)
        if short:
            add(short, "protein_short", f"converted from {p} (MyVariant)")
    for c in variant.hgvs_c:
        add(c, "dna", "MyVariant")
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


def build_aliases(variant: Variant) -> Aliases:
    names = build_alias_list(variant)
    return Aliases(
        gene=variant.gene,
        names=names,
        pubmed_terms=build_pubmed_terms(variant.gene, names),
        trial_terms=build_trial_terms(variant.gene, names),
    )
