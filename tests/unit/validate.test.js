// Tests for the IPC request validators: the allowlist, https-only, method, header and body rules.
import { describe, expect, it } from 'vitest';
import {
  RequestError,
  validateExternalUrl,
  validateFetchRequest,
  validateSaveRequest,
} from '../../electron/validate.js';

const OK = 'https://reactome.org/ContentService/data/database/info';
const codeOf = (fn) => {
  try {
    fn();
  } catch (e) {
    return e instanceof RequestError ? e.code : `other:${e.message}`;
  }
  return 'no-error';
};

describe('validateFetchRequest', () => {
  it('accepts an allowlisted https GET and normalizes it', () => {
    const r = validateFetchRequest(OK, { cacheTtlSeconds: 60 });
    expect(r.method).toBe('GET');
    expect(r.url.hostname).toBe('reactome.org');
    expect(r.cacheTtlSeconds).toBe(60);
  });
  it('rejects non-allowlisted hosts (including look-alikes)', () => {
    expect(codeOf(() => validateFetchRequest('https://evil.example.com/x'))).toBe(
      'host-not-allowed',
    );
    expect(codeOf(() => validateFetchRequest('https://reactome.org.evil.com/x'))).toBe(
      'host-not-allowed',
    );
    expect(codeOf(() => validateFetchRequest('https://sub.reactome.org/x'))).toBe(
      'host-not-allowed',
    );
  });
  it('rejects non-https URLs, credentials and custom ports', () => {
    expect(codeOf(() => validateFetchRequest('http://reactome.org/x'))).toBe('not-https');
    expect(codeOf(() => validateFetchRequest('file:///etc/passwd'))).toBe('not-https');
    expect(codeOf(() => validateFetchRequest('https://user:pw@reactome.org/x'))).toBe('bad-url');
    expect(codeOf(() => validateFetchRequest('https://reactome.org:8443/x'))).toBe('bad-url');
  });
  it('rejects garbage URLs', () => {
    expect(codeOf(() => validateFetchRequest(42))).toBe('bad-url');
    expect(codeOf(() => validateFetchRequest('not a url'))).toBe('bad-url');
    expect(codeOf(() => validateFetchRequest(`https://reactome.org/${'a'.repeat(5000)}`))).toBe(
      'bad-url',
    );
  });
  it('allows only GET and POST', () => {
    for (const method of ['PUT', 'DELETE', 'PATCH', 'HEAD']) {
      expect(codeOf(() => validateFetchRequest(OK, { method }))).toBe('method-not-allowed');
    }
  });
  it('allows POST only to the Analysis Service identifiers endpoint', () => {
    const analysis = 'https://reactome.org/AnalysisService/identifiers/projection?pageSize=5';
    expect(
      validateFetchRequest(analysis, {
        method: 'POST',
        body: 'TP53\nBRCA1',
        headers: { 'Content-Type': 'text/plain' },
      }).method,
    ).toBe('POST');
    expect(codeOf(() => validateFetchRequest(OK, { method: 'POST', body: 'x' }))).toBe(
      'post-not-allowed',
    );
  });
  it('rejects bodies on GET, non-string bodies and oversized bodies', () => {
    const analysis = 'https://reactome.org/AnalysisService/identifiers/projection';
    expect(codeOf(() => validateFetchRequest(OK, { body: 'x' }))).toBe('bad-body');
    expect(codeOf(() => validateFetchRequest(analysis, { method: 'POST', body: { a: 1 } }))).toBe(
      'bad-body',
    );
    expect(
      codeOf(() => validateFetchRequest(analysis, { method: 'POST', body: 'x'.repeat(1_000_001) })),
    ).toBe('body-too-large');
  });
  it('only allows a small set of headers', () => {
    expect(codeOf(() => validateFetchRequest(OK, { headers: { Authorization: 'x' } }))).toBe(
      'header-not-allowed',
    );
    expect(
      codeOf(() => validateFetchRequest(OK, { headers: { 'Content-Type': 'text/html' } })),
    ).toBe('header-not-allowed');
    expect(
      validateFetchRequest(OK, { headers: { Accept: 'application/json' } }).headers.accept,
    ).toBe('application/json');
  });
  it('clamps cache TTL and timeout, uses a longer timeout for the Analysis Service', () => {
    expect(validateFetchRequest(OK, { cacheTtlSeconds: 10 ** 9 }).cacheTtlSeconds).toBe(
      7 * 24 * 3600,
    );
    expect(validateFetchRequest(OK, { timeoutMs: 10 ** 9 }).timeoutMs).toBe(120_000);
    expect(validateFetchRequest(OK).timeoutMs).toBe(20_000);
    expect(validateFetchRequest('https://reactome.org/AnalysisService/token/x').timeoutMs).toBe(
      60_000,
    );
    expect(codeOf(() => validateFetchRequest(OK, { cacheTtlSeconds: -1 }))).toBe('bad-option');
  });
});

describe('validateExternalUrl', () => {
  it('accepts allowlisted https links only', () => {
    expect(validateExternalUrl('https://www.uniprot.org/uniprotkb/P04637/entry')).toContain(
      'uniprot.org',
    );
    expect(codeOf(() => validateExternalUrl('https://evil.example.com'))).toBe('host-not-allowed');
    expect(codeOf(() => validateExternalUrl('http://reactome.org'))).toBe('not-https');
    expect(codeOf(() => validateExternalUrl('java' + 'script:alert(1)'))).toBe('not-https');
  });
});

describe('validateSaveRequest', () => {
  it('accepts a normal request and rejects bad names/encodings', () => {
    expect(validateSaveRequest({ defaultName: 'results.csv', content: 'a,b' }).encoding).toBe(
      'utf8',
    );
    expect(
      codeOf(() => validateSaveRequest({ defaultName: '../../etc/passwd', content: 'x' })),
    ).toBe('bad-save');
    expect(
      codeOf(() => validateSaveRequest({ defaultName: 'a.txt', content: 'x', encoding: 'hex' })),
    ).toBe('bad-save');
    expect(codeOf(() => validateSaveRequest(null))).toBe('bad-save');
  });
});
