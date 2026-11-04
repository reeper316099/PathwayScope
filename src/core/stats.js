// Display helpers for enrichment statistics: significance buckets, ratios and number formatting.

// Significance thresholds on the FDR (shown in the UI legend). Edit here and the whole app follows.
export const SIGNIFICANCE_THRESHOLDS = { strong: 0.001, moderate: 0.01, weak: 0.05 };

// Column label. Reactome documents its multiple-testing correction as Benjamini-Hochberg.
export const FDR_LABEL = 'FDR (Benjamini-Hochberg)';
export const PVALUE_LABEL = 'p-value (hypergeometric, uncorrected)';

// Reactome's p-values bottom out near 1e-16 (floating-point precision), so smaller values are shown as a bound.
export const P_VALUE_FLOOR = 1e-15;

// Legend rows for the UI (label text never relies on color alone).
export const SIGNIFICANCE_LEGEND = [
  { key: 'strong', label: 'Strong', rule: `FDR < ${SIGNIFICANCE_THRESHOLDS.strong}` },
  { key: 'moderate', label: 'Moderate', rule: `FDR < ${SIGNIFICANCE_THRESHOLDS.moderate}` },
  { key: 'weak', label: 'Weak', rule: `FDR < ${SIGNIFICANCE_THRESHOLDS.weak}` },
  { key: 'none', label: 'Not significant', rule: `FDR ≥ ${SIGNIFICANCE_THRESHOLDS.weak}` },
];

// Maps an FDR to a bucket; returns null (never "none") when the FDR is missing or invalid.
export function significanceBucket(fdr) {
  if (typeof fdr !== 'number' || !Number.isFinite(fdr) || fdr < 0 || fdr > 1.0000001) return null;
  if (fdr < SIGNIFICANCE_THRESHOLDS.strong) return 'strong';
  if (fdr < SIGNIFICANCE_THRESHOLDS.moderate) return 'moderate';
  if (fdr < SIGNIFICANCE_THRESHOLDS.weak) return 'weak';
  return 'none';
}

// Fraction of a pathway's entities that were found (found / total); null if total is not a positive number.
export function foundRatio(found, total) {
  if (!Number.isFinite(found) || !Number.isFinite(total) || total <= 0 || found < 0) return null;
  return found / total;
}

// Formats a p-value or FDR: bounds below the precision floor, plain decimals when >= 0.001, else scientific.
export function formatPValue(p) {
  if (typeof p !== 'number' || !Number.isFinite(p) || p < 0) return 'not available';
  if (p < P_VALUE_FLOOR) return `< 1e-15`;
  if (p >= 0.001) return p >= 0.1 ? p.toFixed(2) : p.toPrecision(2);
  return p.toExponential(1);
}

// -log10 of a p-value/FDR for charts, capped so a floor-level value does not become infinite.
export const NEG_LOG10_CAP = 15;
export function negLog10(p) {
  if (typeof p !== 'number' || !Number.isFinite(p) || p < 0) return null;
  return Math.min(NEG_LOG10_CAP, 0 - Math.log10(Math.max(p, 10 ** -NEG_LOG10_CAP)));
}

// Formats "found / total" counts with the ratio as a percentage, e.g. "7 / 86 (8.1%)".
export function formatFoundTotal(found, total) {
  const r = foundRatio(found, total);
  return r === null ? 'not available' : `${found} / ${total} (${(r * 100).toFixed(1)}%)`;
}

// Formats a count and percentage like "48 of 50 (96.0%)" for mapped/unmapped summaries.
export function formatShare(part, whole) {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return 'not available';
  return `${part} of ${whole} (${((part / whole) * 100).toFixed(1)}%)`;
}

// Canonical row order for tables and the network: best FDR first. Many pathways tie at Reactome's precision floor, so ties are
// broken by more entities found, then by name. The order among floor-tied rows is a convenience, not a statistical ranking.
export function compareRows(a, b) {
  return a.fdr - b.fdr || b.entitiesFound - a.entitiesFound || a.name.localeCompare(b.name);
}
