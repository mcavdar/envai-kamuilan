import test from 'node:test';
import assert from 'node:assert/strict';

import {
  connectDatabase,
  createSearchRegex,
  isAllowedPdfUrl,
  normalizeEmploymentType,
  normalizePdfTarget,
  normalizeSchemaDate,
  parsePositiveInteger,
  renderJobDetailPage,
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

test('normalizeSchemaDate and normalizeEmploymentType format structured data correctly', () => {
  assert.equal(normalizeSchemaDate('31.12.2024'), '2024-12-31');
  assert.equal(normalizeSchemaDate('2025-01-05'), '2025-01-05');
  assert.equal(normalizeEmploymentType('Kadrolu / Tam Zamanlı'), 'FULL_TIME');
  assert.equal(normalizeEmploymentType('Sözleşmeli'), 'CONTRACTOR');
});

test('createSearchRegex matches Turkish characters, case variants, and normalized whitespace', () => {
  const search = value => {
    const { $regex, $options } = createSearchRegex(value);
    return new RegExp($regex, $options).test('ÇAĞRI   ÖĞRETİM ÜYESİ');
  };

  assert.equal(search('cagri ogretim uyesi'), true);
  assert.equal(search('ÇAĞRI   ÖĞRETİM ÜYESİ'), true);
  assert.equal(search('cagri ogrenci'), false);
});

test('job detail page emits one JobPosting JSON-LD item with a cleaned location', () => {
  const html = renderJobDetailPage({
    job_title: 'Profesör',
    organization_name: 'Marmara Üniversitesi Rektörlüğü',
    job_description: 'İlan detayları.',
    location: 'Istanbul, NONE',
    datePosted: '2026-09-29',
    application_end_date: '2026-10-13',
  }, 'https://kamuilan.envai.tr/ilan/example');

  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.equal((html.match(/"@type":"JobPosting"/g) || []).length, 1);
  assert.doesNotMatch(html, /itemscope|itemprop=|itemtype=/);
  assert.doesNotMatch(html, /type="`application\/ld\+json`"/);

  const structuredData = JSON.parse(scripts[0][1]);
  assert.equal(structuredData.jobLocation.name, 'Istanbul');
  assert.equal(structuredData.jobLocation.address.addressLocality, 'Istanbul');
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
