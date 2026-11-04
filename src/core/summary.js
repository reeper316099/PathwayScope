// "What this means" sentences. Built ONLY from computed numbers and the thresholds in stats.js; no biological claims.
import { SIGNIFICANCE_THRESHOLDS, P_VALUE_FLOOR, formatPValue } from './stats.js';

export const UNMAPPED_WARNING_FRACTION = 0.2;

// Returns an array of plain-text sentences describing an analysis session at a given FDR cutoff.
export function buildInterpretation(session, { fdrCutoff = SIGNIFICANCE_THRESHOLDS.weak } = {}) {
  const lines = [];
  const submitted = session.inputIdentifiers.length;
  const unmapped = session.unmappedIdentifiers.length;
  const mapped = Math.max(0, submitted - unmapped);
  const pct = (n, d) => (d > 0 ? ((n / d) * 100).toFixed(1) : '0.0');

  lines.push(
    `${mapped} of ${submitted} submitted identifiers (${pct(mapped, submitted)}%) were mapped to Reactome entities; ${unmapped} were not.`,
  );
  if (submitted > 0 && unmapped / submitted > UNMAPPED_WARNING_FRACTION) {
    lines.push(
      `More than ${UNMAPPED_WARNING_FRACTION * 100}% of the list could not be mapped, so the results describe only the mapped part of your list.`,
    );
  }
  if (session.rows.length === 0) {
    lines.push(
      'Reactome returned no pathways with at least one matching entity, so there is nothing to test.',
    );
  } else {
    const hits = session.rows.filter((r) => r.fdr < fdrCutoff);
    const count = (bucket) => hits.filter((r) => r.significance === bucket).length;
    const tested =
      session.pathwaysTested === null
        ? `${session.rows.length} listed`
        : String(session.pathwaysTested);
    lines.push(
      `Reactome tested ${tested} pathways that contain at least one of your entities. ${hits.length} pass the FDR < ${fdrCutoff} cutoff you selected (strong ${count('strong')}, moderate ${count('moderate')}, weak ${count('weak')}).`,
    );
    if (hits.length > 0) {
      const best = hits[0];
      lines.push(
        `The first pathway in the results (best FDR, ties broken by more entities found) is "${best.name}": ${best.entitiesFound} of its ${best.entitiesTotal} entities were found in your list (FDR ${formatPValue(best.fdr)}, uncorrected p ${formatPValue(best.pValue)}).`,
      );
    }
    const floored = session.rows.filter((r) => r.pValue < P_VALUE_FLOOR).length;
    if (floored > 0) {
      lines.push(
        `${floored} pathways sit at Reactome's numerical precision floor (p < 1e-15). Their order relative to each other is not a meaningful ranking.`,
      );
    }
  }
  lines.push(
    `Significance labels: strong FDR < ${SIGNIFICANCE_THRESHOLDS.strong}, moderate FDR < ${SIGNIFICANCE_THRESHOLDS.moderate}, weak FDR < ${SIGNIFICANCE_THRESHOLDS.weak}. FDR (Benjamini-Hochberg) controls the expected share of false hits among the pathways called significant.`,
  );
  lines.push(
    'Over-representation results are hypothesis-generating, not proof. They depend on the background set and on how your identifiers were mapped.',
  );
  return lines;
}
