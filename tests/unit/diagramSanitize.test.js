// Tests for the SVG sanitizer hook and config. A stub purifier stands in for DOMPurify (which needs a real DOM; the
// real DOMPurify behaviour on Reactome's actual SVG is verified in the browser/Electron end-to-end tests).
import { describe, expect, it } from 'vitest';
import { DATA_PNG, sanitizeSvg } from '../../src/core/diagramSanitize.js';

// Builds a fake DOMPurify that runs the registered hook over fake nodes and records the config.
function stubPurifier(nodes) {
  const hooks = [];
  const calls = { config: null, removed: false };
  return {
    calls,
    addHook: (_name, fn) => hooks.push(fn),
    removeHook: () => {
      calls.removed = true;
    },
    sanitize: (text, config) => {
      calls.config = config;
      nodes.forEach((n) => hooks.forEach((fn) => fn(n)));
      return `sanitized:${text}`;
    },
  };
}
// A fake DOM node with attributes.
function node(attrs) {
  const a = { ...attrs };
  return {
    getAttribute: (k) => (k in a ? a[k] : null),
    removeAttribute: (k) => {
      delete a[k];
    },
    attrs: a,
  };
}

describe('DATA_PNG', () => {
  it('accepts embedded PNG data including line-wrapped base64 and rejects everything else', () => {
    expect(DATA_PNG.test('data:image/png;base64,iVBORw0K\n  GgoAAAANSUhEUg==')).toBe(true);
    for (const bad of [
      'http://evil.example/x.png',
      'java' + 'script:alert(1)',
      'data:image/svg+xml;base64,AAAA',
      'data:text/html;base64,AAAA',
      '#local',
      '',
      'data:image/png;base64,<script>',
    ]) {
      expect(DATA_PNG.test(bad)).toBe(false);
    }
  });
});

describe('sanitizeSvg', () => {
  it('keeps embedded PNG hrefs and removes external, javascript and non-PNG hrefs plus style attributes', () => {
    const keep = node({ 'xlink:href': 'data:image/png;base64,AAAA\nBBBB' });
    const external = node({ href: 'https://evil.example/x.png' });
    const script = node({ 'xlink:href': 'java' + 'script:alert(1)' });
    const styled = node({ style: 'fill:red', fill: 'red' });
    const p = stubPurifier([keep, external, script, styled]);
    expect(sanitizeSvg('<svg/>', p)).toBe('sanitized:<svg/>');
    expect(keep.attrs['xlink:href']).toBeDefined();
    expect(external.attrs.href).toBeUndefined();
    expect(script.attrs['xlink:href']).toBeUndefined();
    expect(styled.attrs.style).toBeUndefined();
    expect(styled.attrs.fill).toBe('red');
  });
  it('forbids scripts, foreign content, links, animation and style elements, and always removes its hook', () => {
    const p = stubPurifier([]);
    sanitizeSvg('<svg/>', p);
    for (const tag of [
      'script',
      'foreignObject',
      'style',
      'a',
      'use',
      'animate',
      'set',
      'iframe',
      'object',
      'embed',
    ]) {
      expect(p.calls.config.FORBID_TAGS).toContain(tag);
    }
    expect(p.calls.config.USE_PROFILES).toEqual({ svg: true });
    expect(p.calls.config.FORBID_ATTR).toContain('style');
    expect(p.calls.removed).toBe(true);
  });
  it('removes its hook even if sanitizing throws', () => {
    const p = stubPurifier([]);
    p.sanitize = () => {
      throw new Error('boom');
    };
    expect(() => sanitizeSvg('<svg/>', p)).toThrow('boom');
    expect(p.calls.removed).toBe(true);
  });
});
