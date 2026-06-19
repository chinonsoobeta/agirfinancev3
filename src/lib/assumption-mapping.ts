// Stage 2 of the extraction pipeline: DETERMINISTIC alias mapping. Given the
// regex candidates from Stage 1, this module maps each candidate to a canonical
// assumption key using ONLY its label hint, surrounding context, and unit/kind
// compatibility — no LLM, no invented values. The AI classifier (when an API
// key is configured) is a secondary pass for candidates this mapper leaves
// unresolved; it can never override a deterministic mapping and can never mint
// a value the regex pass did not already lift from a document.

import type { Candidate, CandidateKind } from "./assumption-candidates.server";
import { ASSUMPTION_DEFS, ASSUMPTION_BY_KEY, type AssumptionDef } from "./assumption-taxonomy";

// Candidate kinds that are admissible for a taxonomy unit. This is a guard
// against gross mismatches (e.g. a percentage mapping to a dollar field); the
// label match is the primary signal.
function kindFitsKey(kind: CandidateKind, def: AssumptionDef): boolean {
  switch (def.unit) {
    case "%":
      return kind === "percent";
    case "SF":
      return kind === "sf";
    case "units":
      return kind === "units";
    case "x":
      return kind === "ratio";
    case "yr":
    case "mo":
      return kind === "duration";
    case "$":
      // residential_rent_monthly is unit "$" but arrives as a monthly rent.
      return kind === "currency" || kind === "rent";
    case "$/SF":
      return kind === "rent" || kind === "currency";
    case "text":
      return true;
    default:
      return kind === "currency";
  }
}

// All search strings for a definition, longest-first so the most specific alias
// wins (e.g. "residential occupancy" beats the generic "occupancy").
function aliasStrings(def: AssumptionDef): string[] {
  const set = new Set<string>();
  set.add(def.key.replace(/_/g, " "));
  set.add(def.label.toLowerCase());
  for (const a of def.aliases) set.add(a.toLowerCase());
  return Array.from(set).filter((s) => s.length >= 3);
}

const ALIAS_TABLE: Array<{ def: AssumptionDef; alias: string }> = ASSUMPTION_DEFS.flatMap((def) =>
  aliasStrings(def).map((alias) => ({ def, alias })),
).sort((a, b) => b.alias.length - a.alias.length);

export type CandidateMapping = {
  field_key: string;
  confidence: number;
  via: "alias";
  matched_alias: string;
  where: "hint" | "context";
};

// Deterministically map one candidate to a canonical key, or null.
//
// The label hint (text immediately left of the value) is the primary signal,
// and within it PROXIMITY wins: the alias whose match ends closest to the value
// is chosen, because the label nearest a number is the one that names it. (The
// hint window can spill into a prior line's label; a plain "longest alias" rule
// would mis-assign e.g. a terminal-cap value sitting after a longer, earlier
// label.) Ties break toward the longer alias. Only the broader context is used
// as a fallback when nothing matches in the hint. Unit/kind compatibility gates
// every candidate so a percentage never lands on a dollar field.
// A loan/debt label immediately preceding a value means the value IS the
// debt — it must never be read as a stated total project cost.
const LOAN_DEBT_LABEL_RE = /(senior\s+(construction\s+)?(loan|debt)|loan amount|loan facility|facility size|debt amount|mortgage|preferred equity|common equity|senior debt)/i;

export function mapCandidateToKey(cand: Candidate, exclude: Set<string> = new Set()): CandidateMapping | null {
  const hint = (cand.label_hint || "").toLowerCase();

  // Match against the line-scoped label hint, preferring the alias whose match
  // ends closest to the value (the nearest label names it). We deliberately do
  // NOT fall back to the broader multi-line context: that let a value inherit a
  // neighbouring line's label and produced false conflicts.
  let best: CandidateMapping | null = null;
  let bestEnd = -1;
  let bestLen = -1;
  for (const { def, alias } of ALIAS_TABLE) {
    if (exclude.has(def.key)) continue;
    if (!kindFitsKey(cand.kind, def)) continue;
    const idx = hint.lastIndexOf(alias);
    if (idx < 0) continue;
    const end = idx + alias.length;
    if (end > bestEnd || (end === bestEnd && alias.length > bestLen)) {
      bestEnd = end;
      bestLen = alias.length;
      best = { field_key: def.key, confidence: 90, via: "alias", matched_alias: alias, where: "hint" };
    }
  }

  // Hard guard: a value whose nearest label is a loan/debt/equity tranche term
  // can never be a stated total project cost (this is exactly the mis-map that
  // turned the $162.5M senior loan into a bogus stated total). Re-pick excluding
  // total_project_cost so it lands on debt_amount (or nothing) instead.
  if (best && best.field_key === "total_project_cost" && !exclude.has("total_project_cost")) {
    const tail = hint.slice(-32);
    if (LOAN_DEBT_LABEL_RE.test(tail)) {
      return mapCandidateToKey(cand, new Set([...exclude, "total_project_cost"]));
    }
  }
  return best;
}

export type MappedCandidate = {
  field_key: string;
  value_numeric: number | null;
  value_text: string | null;
  unit: string;
  confidence: number;
  source_doc_name: string;
  source_text: string;
  source_location: string | null;
  matched_alias: string;
  via: "alias";
};

// Map every candidate deterministically; unmapped candidates are dropped.
export function mapCandidates(candidates: Candidate[]): MappedCandidate[] {
  const out: MappedCandidate[] = [];
  for (const c of candidates) {
    const m = mapCandidateToKey(c);
    if (!m) continue;
    const def = ASSUMPTION_BY_KEY[m.field_key];
    if (!def) continue;
    if (def.numeric && c.value_numeric == null) continue;
    out.push({
      field_key: def.key,
      value_numeric: def.numeric ? c.value_numeric : null,
      value_text: def.numeric ? null : c.value_text,
      unit: def.unit,
      confidence: m.confidence,
      source_doc_name: c.doc_name,
      source_text: c.context,
      source_location: c.source_location,
      matched_alias: m.matched_alias,
      via: m.via,
    });
  }
  return out;
}

export type GroupResolution = {
  field_key: string;
  status: "extracted" | "conflicting";
  value_numeric: number | null;
  value_text: string | null;
  winner: MappedCandidate;
  members: MappedCandidate[];
  distinct: Array<number | string | null>;
  conflict_values: Array<{ value: number | string | null; source: string }> | null;
};

const roundKey = (m: MappedCandidate): number | string | null =>
  m.value_numeric != null ? Math.round(m.value_numeric * 1000) / 1000 : m.value_text;

// Group mapped candidates by key and resolve each group. Multiple DISTINCT
// values for one key become a conflict: no value is chosen, both sources are
// preserved, and the key must block underwriting. Values are never averaged.
export function groupAndResolve(mapped: MappedCandidate[]): Map<string, GroupResolution> {
  const groups = new Map<string, MappedCandidate[]>();
  for (const m of mapped) {
    const arr = groups.get(m.field_key) ?? [];
    arr.push(m);
    groups.set(m.field_key, arr);
  }

  const out = new Map<string, GroupResolution>();
  for (const [field_key, members] of groups.entries()) {
    members.sort((a, b) => b.confidence - a.confidence);
    const distinct = Array.from(new Set(members.map(roundKey)));
    const isConflict = distinct.length > 1;
    const winner = members[0];
    const conflict_values = isConflict
      ? members
          .filter((m) => m.value_numeric != null || m.value_text != null)
          .map((m) => ({ value: roundKey(m), source: m.source_doc_name }))
          .filter((c, i, all) => all.findIndex((x) => x.value === c.value) === i)
      : null;
    out.set(field_key, {
      field_key,
      status: isConflict ? "conflicting" : "extracted",
      value_numeric: isConflict ? null : winner.value_numeric,
      value_text: isConflict ? null : winner.value_text,
      winner,
      members,
      distinct,
      conflict_values,
    });
  }
  return out;
}

// ---------- Stage 1.5: candidate prioritisation ----------
//
// Used to bound the OPTIONAL AI classifier prompt without dropping important
// values. Deterministic mapping itself runs over ALL candidates (no cap), so
// canonical Harbour values are never pushed beyond a limit.

export type RankedCandidate = { candidate: Candidate; index: number; score: number };

const KIND_WEIGHT: Record<CandidateKind, number> = {
  currency: 5, percent: 5, rent: 5, sf: 4, units: 4, ratio: 4, duration: 3, date: 0,
};

export function scoreCandidate(cand: Candidate): number {
  let score = KIND_WEIGHT[cand.kind] ?? 1;
  const mapping = mapCandidateToKey(cand);
  if (mapping) {
    score += 50;
    if (mapping.where === "hint") score += 20;
    const def = ASSUMPTION_BY_KEY[mapping.field_key];
    if (def?.required) score += 30;
  }
  return score;
}

// Rank candidates by importance, then guarantee at least `topPerDoc` of each
// document's best candidates and broad kind coverage survive any cap.
export function rankCandidates(
  candidates: Candidate[],
  opts: { cap?: number; topPerDoc?: number } = {},
): Candidate[] {
  const cap = opts.cap ?? 220;
  const topPerDoc = opts.topPerDoc ?? 24;
  if (candidates.length <= cap) return candidates;

  const ranked: RankedCandidate[] = candidates.map((candidate, index) => ({
    candidate,
    index,
    score: scoreCandidate(candidate),
  }));
  const byScore = [...ranked].sort((a, b) => b.score - a.score || a.index - b.index);

  const chosen = new Set<number>();

  // 1) Per-document top-N.
  const perDoc = new Map<string, number>();
  for (const r of byScore) {
    const n = perDoc.get(r.candidate.doc_name) ?? 0;
    if (n < topPerDoc) {
      chosen.add(r.index);
      perDoc.set(r.candidate.doc_name, n + 1);
    }
  }
  // 2) Ensure each kind is represented.
  const kinds = new Set<CandidateKind>();
  for (const r of byScore) {
    if (chosen.has(r.index)) { kinds.add(r.candidate.kind); }
  }
  for (const r of byScore) {
    if (!kinds.has(r.candidate.kind)) { chosen.add(r.index); kinds.add(r.candidate.kind); }
  }
  // 3) Fill remaining capacity by score.
  for (const r of byScore) {
    if (chosen.size >= cap) break;
    chosen.add(r.index);
  }

  return ranked.filter((r) => chosen.has(r.index)).map((r) => r.candidate);
}
