import test from 'node:test';
import assert from 'node:assert/strict';

import {
  connectDatabase,
  isAllowedPdfUrl,
  normalizePdfTarget,
  parsePositiveInteger,
} from '../server.js';

test('parsePositiveInteger accepts valid positive values within the max limit', () => {
  assert.equal(parsePositiveInteger('3', 1, 10), 3);
  assert.equal(parsePositiveInteger('10', 1, 10), 10);
  assert.equal(parsePositiveInteger(undefined, 1, 10), 1);
});

test('parsePositiveInteger rejects invalid or unsafe values', () => {
  assert.equal(parsePositiveInteger('0', 1, 10), null);
  assert.equal(parsePositiveInteger('abc', 1, 10), null);
  assert.equal(parsePositiveInteger('999999999999999999999', 1, 10), null);
  assert.equal(parsePositiveInteger('11', 1, 10), null);
});

test('normalizePdfTarget normalizes legacy sbb URL patterns', () => {
  const normalized = normalizePdfTarget('https:__kamuilan.sbb.gov.tr_/files/2024+report.pdf');
  assert.equal(normalized, 'https://kamuilan.sbb.gov.tr/files/2024%2Breport.pdf');
});

test('isAllowedPdfUrl only allows HTTPS sbb.gov.tr URLs', () => {
  assert.equal(isAllowedPdfUrl(new URL('https://kamuilan.sbb.gov.tr/ilan/1.pdf')), true);
  assert.equal(isAllowedPdfUrl(new URL('https://example.com/file.pdf')), false);
  assert.equal(isAllowedPdfUrl(new URL('http://kamuilan.sbb.gov.tr/file.pdf')), false);
  assert.equal(isAllowedPdfUrl(new URL('https://kamuilan.sbb.gov.tr:8443/file.pdf')), false);
});

test('connectDatabase rejects missing database configuration', async () => {
  await assert.rejects(() => connectDatabase(undefined), /MONGODB_URI/);
});
