// Tests for significance buckets (exact boundaries), ratio math and number formatting.
import { describe, expect, it } from 'vitest';
import {
  FDR_LABEL,
  formatFoundTotal,
  formatPValue,
  formatShare,
  foundRatio,
  negLog10,
  significanceBucket,
} from '../../src/core/stats.js';

describe('significanceBucket (exact FDR boundaries)', () => {
  it.each([
    [0, 'strong'],
    [0.0009999, 'strong'],
    [0.001, 'moderate'],
    [0.0099999, 'moderate'],
    [0.01, 'weak'],
    [0.0499999, 'weak'],
    [0.05, 'none'],
    [0.5, 'none'],
    [1, 'none'],
  ])('FDR %s -> %s', (fdr, bucket) => {
    expect(significanceBucket(fdr)).toBe(bucket);
  });
  it('returns null (not "none") for missing or invalid values', () => {
    for (const bad of [undefined, null, NaN, Infinity, -0.1, 2, '0.01'])
      expect(significanceBucket(bad)).toBeNull();
  });
});

describe('foundRatio', () => {
  it('divides found by total and guards bad input', () => {
    expect(foundRatio(7, 86)).toBeCloseTo(0.0814, 4);
    expect(foundRatio(0, 10)).toBe(0);
    expect(foundRatio(5, 0)).toBeNull();
    expect(foundRatio(-1, 10)).toBeNull();
    expect(foundRatio(NaN, 10)).toBeNull();
  });
});

describe('formatPValue', () => {
  it('uses plain decimals, scientific notation and a floor bound', () => {
    expect(formatPValue(0.5)).toBe('0.50');
    expect(formatPValue(0.0123)).toBe('0.012');
    expect(formatPValue(0.001)).toBe('0.0010');
    expect(formatPValue(1.262323578998803e-12)).toBe('1.3e-12');
    expect(formatPValue(2.220446049250313e-16)).toBe('< 1e-15');
    expect(formatPValue(0)).toBe('< 1e-15');
  });
  it('says "not available" for missing values', () => {
    expect(formatPValue(undefined)).toBe('not available');
    expect(formatPValue(NaN)).toBe('not available');
    expect(formatPValue(-1)).toBe('not available');
  });
});

describe('negLog10', () => {
  it('computes and caps at 15', () => {
    expect(negLog10(0.01)).toBeCloseTo(2, 10);
    expect(negLog10(1)).toBe(0);
    expect(negLog10(1e-30)).toBe(15);
    expect(negLog10(0)).toBe(15);
    expect(negLog10(NaN)).toBeNull();
  });
});

describe('text formatters', () => {
  it('formats counts and shares', () => {
    expect(formatFoundTotal(7, 86)).toBe('7 / 86 (8.1%)');
    expect(formatFoundTotal(1, 0)).toBe('not available');
    expect(formatShare(48, 50)).toBe('48 of 50 (96.0%)');
    expect(formatShare(1, 0)).toBe('not available');
  });
  it('labels FDR with the method Reactome documents', () => {
    expect(FDR_LABEL).toBe('FDR (Benjamini-Hochberg)');
  });
});
