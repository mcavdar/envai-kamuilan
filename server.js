import express from 'express';
import mongoose from 'mongoose';
import compression from 'compression';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import axios from 'axios';
import https from 'https';

dotenv.config();

const configuredPublicBaseUrl = process.env.PUBLIC_BASE_URL?.trim();
let publicBaseUrl = '';

if (configuredPublicBaseUrl) {
  try {
    const parsedPublicBaseUrl = new URL(configuredPublicBaseUrl);
    if (!['http:', 'https:'].includes(parsedPublicBaseUrl.protocol)) {
      throw new Error('PUBLIC_BASE_URL must use HTTP or HTTPS');
    }
    publicBaseUrl = parsedPublicBaseUrl.origin;
  } catch (err) {
    console.error(`Invalid PUBLIC_BASE_URL: ${err.message}`);
    process.exit(1);
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(compression());

// Statik frontend
app.use(express.static(path.join(__dirname, 'public')));

// --- Job Schema & Model ---
const jobSchema = new mongoose.Schema({}, {
    strict: false
});

const Job = mongoose.model('Job', jobSchema);
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_FILTER_LENGTH = 200;
const MAX_PAGE_NUMBER = 1_000_000;

export function parsePositiveInteger(value, fallback, max) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= max ? parsed : null;
}

// Utility to escape regex control characters safely
function escapeRegex(text) {
    return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

const turkishSearchCharacterGroups = {
  c: 'cCçÇ',
  ç: 'cCçÇ',
  g: 'gGğĞ',
  ğ: 'gGğĞ',
  i: 'iIİı',
  ı: 'iIİı',
  o: 'oOöÖ',
  ö: 'oOöÖ',
  s: 'sSşŞ',
  ş: 'sSşŞ',
  u: 'uUüÜ',
  ü: 'uUüÜ'
};

export function createSearchRegex(value) {
  const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('tr-TR');
  const pattern = Array.from(normalized, character => {
    if (character === ' ') return '\\s+';

    const turkishGroup = turkishSearchCharacterGroups[character];
    return turkishGroup ? `[${turkishGroup}]` : escapeRegex(character);
  }).join('');

  return { $regex: pattern, $options: 'i' };
}

const jobProjection = {
  _id: 0,
  job_id: {
    $concat: [
      { $toString: "$_id" },
      "-",
      { $toString: "$__postingIndex" }
    ]
  },
  announcement_title: "$extract_result.announcement_title",
  organization_name: "$extract_result.organization_name",
  datePosted: "$extract_result.datePosted",
  application_start_date: "$extract_result.application_start_date",
  application_end_date: "$extract_result.application_end_date",
  application_url: "$extract_result.application_url",
  application_method: "$extract_result.application_method",
  file_url: "$file_url",
  job_title: "$extract_result.job_postings.job_title",
  job_description: "$extract_result.job_postings.job_description",
  qualifications: "$extract_result.job_postings.qualifications",
  specific_requirements: "$extract_result.job_postings.specific_requirements",
  number_of_positions: "$extract_result.job_postings.number_of_positions",
  location: "$extract_result.job_postings.location",
  jobLocation: "$extract_result.job_postings.jobLocation",
  employment_type: "$extract_result.job_postings.employment_type",
  employmentType: "$extract_result.job_postings.employmentType",
  salary_information: "$extract_result.job_postings.salary_information",
  baseSalary: "$extract_result.job_postings.baseSalary",
  mezuniyet: "$extract_result.job_postings.mezuniyet"
};

function parsePublicJobId(value) {
  if (typeof value !== 'string') return null;

  const match = /^([a-f\d]{24})-(\d+)$/.exec(value);
  if (!match) return null;

  const postingIndex = Number.parseInt(match[2], 10);
  if (!Number.isSafeInteger(postingIndex) || postingIndex < 0) return null;

  return {
    sourceId: new mongoose.Types.ObjectId(match[1]),
    postingIndex
  };
}

function publicJobLookupPipeline(publicJobId) {
  const parsedId = parsePublicJobId(publicJobId);
  if (!parsedId) return null;

  return [
    { $match: { _id: parsedId.sourceId } },
    {
      $unwind: {
        path: "$extract_result.job_postings",
        includeArrayIndex: "__postingIndex"
      }
    },
    { $match: { __postingIndex: parsedId.postingIndex } },
    { $project: jobProjection }
  ];
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function normalizeSchemaDate(value) {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const isoMatch = /^\d{4}-\d{2}-\d{2}$/.exec(trimmed);
  if (isoMatch) return trimmed;

  const dmyMatch = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(trimmed);
  if (dmyMatch) {
    const [, day, month, year] = dmyMatch;
    const date = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString().slice(0, 10);
    }
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return null;
}

export function normalizeEmploymentType(value) {
  if (typeof value !== 'string') return 'FULL_TIME';

  const lowered = value.toLowerCase();
  if (lowered.includes('tam') || lowered.includes('kadrolu') || lowered.includes('full')) return 'FULL_TIME';
  if (lowered.includes('yarı') || lowered.includes('part')) return 'PART_TIME';
  if (lowered.includes('sözleşme') || lowered.includes('contract') || lowered.includes('temporary')) return 'CONTRACTOR';
  if (lowered.includes('geçici') || lowered.includes('dönem') || lowered.includes('temporary')) return 'TEMPORARY';
  if (lowered.includes('sağlık') || lowered.includes('intörn') || lowered.includes('staj')) return 'OTHER';

  return 'FULL_TIME';
}

function normalizeBaseSalary(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const amountMatch = /\d+(?:[.,]\d{1,3})*/.exec(trimmed);
  if (!amountMatch) return undefined;

  const numericValue = Number(amountMatch[0].replace('.', '').replace(',', '.'));
  if (!Number.isFinite(numericValue)) return undefined;

  return {
    '@type': 'MonetaryAmount',
    currency: 'TRY',
    value: {
      '@type': 'QuantitativeValue',
      value: numericValue,
      unitText: 'TRY'
    }
  };
}

function renderNotFoundPage() {
  return `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Sayfa bulunamadı | Kamu İlanları</title>
  <style>
    :root { --ink: #17202a; --muted: #53606b; --blue: #145da0; --blue-dark: #0e4679; --paper: #fff; --wash: #f4f6f8; --line: #d9e0e6; --accent: #d96b3f; }
    * { box-sizing: border-box; }
    body { margin: 0; color: var(--ink); background: var(--wash); font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    a { color: var(--blue); }
    .site-header { border-bottom: 1px solid var(--line); background: var(--paper); }
    .header-inner, main, .site-footer-inner { width: min(calc(100% - 48px), 1180px); margin: 0 auto; }
    .header-inner { display: flex; min-height: 78px; align-items: center; }
    .brand { display: inline-flex; align-items: center; gap: 13px; color: var(--ink); text-decoration: none; }
    .brand-mark { display: grid; width: 38px; height: 38px; place-items: center; border: 2px solid var(--blue); color: var(--blue); font: 700 20px/1 Georgia, serif; }
    .brand-name { font: 700 22px/1 Georgia, "Times New Roman", serif; }
    main { display: grid; min-height: calc(100vh - 203px); align-content: center; padding: 64px 0; }
    .content { max-width: 680px; }
    .eyebrow, .footer-eyebrow { margin: 0 0 12px; color: var(--accent); font-size: 12px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
    h1 { max-width: 640px; margin: 0 0 16px; font: 400 clamp(2.7rem, 7vw, 5rem)/1.02 Georgia, "Times New Roman", serif; letter-spacing: -.045em; }
    .description { max-width: 560px; margin: 0 0 28px; color: var(--muted); font-size: 17px; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; }
    .button { display: inline-flex; align-items: center; padding: 10px 14px; border: 1px solid var(--blue); color: var(--paper); background: var(--blue); font-weight: 700; text-decoration: none; }
    .button:hover { background: var(--blue-dark); }
    .button.secondary { color: var(--blue); background: var(--paper); }
    .button.secondary:hover { color: var(--blue-dark); background: #f8fbfd; }
    .help { max-width: 440px; margin-top: 42px; padding: 16px 18px; border-left: 3px solid var(--accent); color: var(--muted); background: var(--paper); }
    .help strong { display: block; margin-bottom: 3px; color: var(--ink); font: 400 20px/1.2 Georgia, serif; }
    .site-footer { border-top: 1px solid var(--line); background: var(--paper); }
    .site-footer-inner { display: flex; min-height: 124px; align-items: center; justify-content: space-between; gap: 24px; padding: 26px 0; }
    .footer-eyebrow { margin-bottom: 4px; font-size: 11px; }
    .footer-copy { margin: 0; color: var(--muted); font-size: 14px; }
    .contact-link { color: var(--blue); font-weight: 700; text-decoration: none; }
    .contact-link:hover { text-decoration: underline; }
    @media (max-width: 600px) {
      .header-inner, main, .site-footer-inner { width: min(calc(100% - 28px), 1180px); }
      .header-inner { min-height: 68px; }
      .brand-name { font-size: 20px; }
      main { min-height: calc(100vh - 185px); padding: 48px 0; }
      .site-footer-inner { align-items: flex-start; flex-direction: column; }
    }
  </style>
</head>
<body>
  <header class="site-header">
    <div class="header-inner">
      <a class="brand" href="/" aria-label="Kamu İlanları ana sayfa">
        <span class="brand-mark" aria-hidden="true">K</span>
        <span class="brand-name">Kamu İlanları</span>
      </a>
    </div>
  </header>
  <main>
    <div class="content">
      <p class="eyebrow">404 · Sayfa bulunamadı</p>
      <h1>Bu ilan artık burada değil.</h1>
      <p class="description">Bağlantı yanlış olabilir veya ilan yayından kaldırılmış olabilir. Güncel ilanlara dönerek yeni bir arama yapabilirsiniz.</p>
      <div class="actions">
        <a class="button" href="/">İlanlara dön <span aria-hidden="true">↗</span></a>
        <a class="button secondary" href="/">Yeni arama yap</a>
      </div>
      <div class="help">
        <strong>Bir sorun mu var?</strong>
        Bağlantının hatalı olduğunu düşünüyorsanız <a href="mailto:mc@envai.tr">mc@envai.tr</a> adresinden bize ulaşabilirsiniz.
      </div>
    </div>
  </main>
  <footer class="site-footer">
    <div class="site-footer-inner">
      <div>
        <p class="footer-eyebrow">Yardıma mı ihtiyacınız var?</p>
        <p class="footer-copy">Kamu ve akademik ilanları tek yerde takip edin.</p>
      </div>
      <a class="contact-link" href="mailto:mc@envai.tr">mc@envai.tr ↗</a>
    </div>
  </footer>
</body>
</html>`;
}

function renderJobDetailPage(job, pageUrl) {
  const title = job.job_title || 'İlan detayı';
  const organization = job.organization_name || 'Kamu İlanları';
  const description = job.job_description || 'İlan detayları.';
  const imageUrl = new URL('/kamuilan.webp', pageUrl).toString();
  const qualifications = Array.isArray(job.qualifications) ? job.qualifications : [];
  const requirements = Array.isArray(job.specific_requirements) ? job.specific_requirements : [];
  const safeApplicationUrl = typeof job.application_url === 'string' && /^https?:\/\//i.test(job.application_url)
    ? job.application_url
    : null;
  const fileTarget = typeof job.file_url === 'string'
    ? job.file_url.replace(/\.json$/i, '')
    : '';
  const documentUrl = fileTarget
    ? `/pdf-viewer?targetUrl=${encodeURIComponent(fileTarget)}`
    : '';
  const shareHtml = '<p><button class="button secondary" id="shareJob" type="button">Paylaş</button> <span id="shareStatus" role="status" aria-live="polite"></span></p>';
  const normalizedLocation = [job.jobLocation, job.location, job['jobLocation'], job['location']]
    .find(value => typeof value === 'string' && value.trim()) || 'Türkiye';
  const normalizedDatePosted = normalizeSchemaDate(job.datePosted || job.application_start_date);
  const normalizedValidThrough = normalizeSchemaDate(job.application_end_date || job.validThrough);
  const normalizedEmploymentType = normalizeEmploymentType(job.employment_type || job.employmentType);
  const normalizedBaseSalary = normalizeBaseSalary(job.salary_information || job.baseSalary);

  const structuredData = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title,
    description,
    hiringOrganization: {
      '@type': 'Organization',
      name: organization
    },
    url: pageUrl,
    datePosted: normalizedDatePosted || undefined,
    validThrough: normalizedValidThrough || undefined,
    employmentType: normalizedEmploymentType,
    jobLocation: {
      '@type': 'Place',
      name: normalizedLocation,
      address: {
        '@type': 'PostalAddress',
        addressCountry: 'TR',
        addressLocality: normalizedLocation
      }
    },
    baseSalary: normalizedBaseSalary || undefined
  }).replaceAll('<', '\\u003c');

  const qualificationsHtml = qualifications.length
    ? `<h2>Mezuniyet ve nitelikler</h2><ul>${qualifications.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    : '';
  const requirementsHtml = requirements.length
    ? `<h2>Özel şartlar</h2><ul>${requirements.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    : '';
  const applicationHtml = safeApplicationUrl
    ? `<p><a class="button" href="${escapeHtml(safeApplicationUrl)}" target="_blank" rel="noopener">Başvuru sayfasını aç</a></p>`
    : '';
  const documentHtml = documentUrl
    ? `<p><a class="button secondary" href="${escapeHtml(documentUrl)}" target="_blank" rel="noopener">İlan belgesini aç</a></p>`
    : '';

  return `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} | ${escapeHtml(organization)}</title>
  <meta name="description" content="${escapeHtml(`${title} - ${organization}`)}">
  <link rel="canonical" href="${escapeHtml(pageUrl)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(`${title} - ${organization}`)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${escapeHtml(pageUrl)}">
  <meta property="og:image" content="${escapeHtml(imageUrl)}">
  <meta property="og:image:alt" content="Kamu İlanları">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(`${title} - ${organization}`)}">
  <meta name="twitter:image" content="${escapeHtml(imageUrl)}">
  <script type="application/ld+json">${structuredData}</script>
  <style>
    :root { color-scheme: light; --ink: #17202a; --muted: #53606b; --blue: #145da0; --line: #d9e0e6; --wash: #f4f6f8; }
    * { box-sizing: border-box; }
    body { margin: 0; color: var(--ink); background: var(--wash); font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { width: min(calc(100% - 32px), 820px); margin: 0 auto; padding: 34px 0 64px; }
    a { color: var(--blue); }
    .back { display: inline-block; margin-bottom: 24px; font-size: 14px; }
    article { padding: 30px; border: 1px solid var(--line); background: #fff; }
    h1 { margin: 0 0 8px; font: 400 clamp(2rem, 5vw, 3.2rem)/1.1 Georgia, "Times New Roman", serif; }
    h2 { margin: 28px 0 8px; font: 400 1.35rem/1.2 Georgia, "Times New Roman", serif; }
    .organization, .meta { color: var(--muted); }
    .description { white-space: pre-line; }
    .button { display: inline-block; margin: 8px 8px 0 0; padding: 9px 13px; border: 0; color: #fff; background: var(--blue); font: inherit; text-decoration: none; cursor: pointer; }
    .button.secondary { color: var(--blue); background: #fff; border: 1px solid var(--blue); }
    @media (max-width: 600px) { article { padding: 22px; } }
  </style>
</head>
<body>
  <main>
    <a class="back" href="/">← Tüm ilanlara dön</a>
    <article itemscope itemtype="https://schema.org/JobPosting">
      <h1 itemprop="title">${escapeHtml(title)}</h1>
      <p class="organization" itemprop="hiringOrganization">${escapeHtml(organization)}</p>
      ${job.announcement_title ? `<p class="meta">${escapeHtml(job.announcement_title)}</p>` : ''}
      ${job.number_of_positions ? `<p class="meta"><strong>Kadro:</strong> ${escapeHtml(job.number_of_positions)}</p>` : ''}
      ${job.application_end_date ? `<p class="meta"><strong>Son tarih:</strong> ${escapeHtml(job.application_end_date)}</p>` : ''}
      <h2>Açıklama</h2>
      <p class="description" itemprop="description">${escapeHtml(description)}</p>
      ${qualificationsHtml}
      ${requirementsHtml}
      ${shareHtml}
      ${job.application_method ? `<h2>Başvuru</h2><p>${escapeHtml(job.application_method)}</p>` : ''}
      ${applicationHtml}
      ${documentHtml}
    </article>
  </main>
  <script>
    const shareButton = document.getElementById('shareJob');
    const shareStatus = document.getElementById('shareStatus');

    async function copyShareUrl(url) {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
        return;
      }

      const textarea = document.createElement('textarea');
      textarea.value = url;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();

      if (!copied) throw new Error('Unable to copy URL');
    }

    shareButton.addEventListener('click', async () => {
      const url = window.location.href;
      shareButton.disabled = true;
      shareStatus.textContent = '';

      try {
        if (typeof navigator.share === 'function') {
          await navigator.share({ title: document.title, url });
          shareStatus.textContent = 'Paylaşım hazır.';
        } else {
          await copyShareUrl(url);
          shareStatus.textContent = 'Bağlantı kopyalandı.';
        }
      } catch (error) {
        if (error.name !== 'AbortError') shareStatus.textContent = 'Bağlantı kopyalanamadı.';
      } finally {
        shareButton.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}

function getPublicUrl(req, pathname) {
  const baseUrl = publicBaseUrl || `${req.protocol}://${req.get('host')}`;
  return new URL(pathname, `${baseUrl}/`).toString();
}

app.get('/sitemap.xml', async (req, res) => {
  try {
    const jobs = await Job.aggregate([
      {
        $unwind: {
          path: "$extract_result.job_postings",
          includeArrayIndex: "__postingIndex"
        }
      },
      {
        $project: {
          _id: 0,
          job_id: {
            $concat: [
              { $toString: "$_id" },
              "-",
              { $toString: "$__postingIndex" }
            ]
          }
        }
      }
    ]);

    const urls = [getPublicUrl(req, '/')]
      .concat(jobs.map(job => getPublicUrl(req, `/ilan/${job.job_id}`)));
    const urlEntries = urls
      .map(url => `  <url><loc>${escapeHtml(url)}</loc></url>`)
      .join('\n');

    const sitemap = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      urlEntries,
      '</urlset>'
    ].join('\n');

    res.type('application/xml').send(sitemap);
  } catch (err) {
    console.error(err);
    res.status(500).type('text/plain').send('Unable to generate sitemap');
  }
});

app.get('/robots.txt', (req, res) => {
  const sitemapUrl = getPublicUrl(req, '/sitemap.xml');
  res.type('text/plain').send([
    'User-agent: *',
    'Allow: /',
    `Sitemap: ${sitemapUrl}`
  ].join('\n'));
});

// --- Distinct Mezuniyetler API ---
app.get('/api/jobs/mezuniyetler', async (req, res) => {
  try {
    const rawList = await Job.distinct('extract_result.job_postings.mezuniyet');
    const set = new Set();
    for (const item of rawList) {
      if (Array.isArray(item)) {
        item.forEach(m => m && typeof m === 'string' && set.add(m.trim()));
      } else if (typeof item === 'string' && item.trim()) {
        set.add(item.trim());
      }
    }
    res.json({ mezuniyetler: Array.from(set).sort() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Unable to load graduation options' });
  }
});

// --- Jobs API ---
app.get('/api/jobs', async (req, res) => {
  try {
    const {
      keyword,
      unvan,
      mezuniyet,
      page,
      limit
    } = req.query;

    const normalizedFilters = {};
    for (const [name, value] of Object.entries({ keyword, unvan, mezuniyet })) {
      if (value === undefined) continue;
      if (typeof value !== 'string') {
        return res.status(400).json({ error: 'Invalid query parameters' });
      }

      const normalizedValue = value.trim();
      if (normalizedValue.length > MAX_FILTER_LENGTH) {
        return res.status(400).json({ error: 'Invalid query parameters' });
      }

      normalizedFilters[name] = normalizedValue;
    }

    const pageNumber = parsePositiveInteger(page, 1, MAX_PAGE_NUMBER);
    const pageSize = parsePositiveInteger(limit, 10, 100);
    if (pageNumber === null || pageSize === null) {
      return res.status(400).json({ error: 'Invalid query parameters' });
    }

    const keywordFilter = normalizedFilters.keyword;
    const unvanFilter = normalizedFilters.unvan;
    const mezuniyetFilter = normalizedFilters.mezuniyet;
    const skip = (pageNumber - 1) * pageSize;

    const pipeline = [];

    // Deconstruct job postings array
    pipeline.push({
      $unwind: {
        path: "$extract_result.job_postings",
        includeArrayIndex: "__postingIndex"
      }
    });

    const match = {};

    if (unvanFilter) {
      match["extract_result.job_postings.job_title"] = createSearchRegex(unvanFilter);
    }

    if (mezuniyetFilter) {
      match.$or = match.$or || [];
      match.$or.push(
        { "extract_result.job_postings.mezuniyet": createSearchRegex(mezuniyetFilter) },
        { "extract_result.job_postings.qualifications": createSearchRegex(mezuniyetFilter) }
      );
    }

    if (keywordFilter) {
      const regex = createSearchRegex(keywordFilter);

      const keywordConditions = [
        { "extract_result.announcement_title": regex },
        { "extract_result.organization_name": regex },
        { "extract_result.job_postings.job_title": regex },
        { "extract_result.job_postings.location": regex },
        { "extract_result.job_postings.job_description": regex },
        { "extract_result.job_postings.qualifications": regex },
        { "extract_result.job_postings.specific_requirements": regex }
      ];

      if (match.$or) {
        match.$and = [
          { $or: match.$or },
          { $or: keywordConditions }
        ];
        delete match.$or;
      } else {
        match.$or = keywordConditions;
      }
    }

    if (Object.keys(match).length)
      pipeline.push({ $match: match });

    const countPipeline = [...pipeline, { $count: "total" }];

    pipeline.push(
      { $sort: { created_at: -1, _id: 1, __postingIndex: 1 } },
      { $skip: skip },
      { $limit: pageSize },
      { $project: jobProjection }
    );

    const [jobs, count] = await Promise.all([
      Job.aggregate(pipeline),
      Job.aggregate(countPipeline)
    ]);

    const total = count[0]?.total || 0;

    res.json({
      jobs,
      total,
      page: pageNumber,
      limit: pageSize,
      totalPages: Math.ceil(total / pageSize)
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Unable to load jobs' });
  }
});

app.get('/api/jobs/:jobId', async (req, res) => {
  const pipeline = publicJobLookupPipeline(req.params.jobId);
  if (!pipeline) {
    return res.status(400).json({ error: 'Invalid job identifier' });
  }

  try {
    const [job] = await Job.aggregate(pipeline);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({ job });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Unable to load job' });
  }
});

app.get('/ilan/:jobId', async (req, res) => {
  const pipeline = publicJobLookupPipeline(req.params.jobId);
  if (!pipeline) {
    return res.status(404).type('html').send(renderNotFoundPage());
  }

  try {
    const [job] = await Job.aggregate(pipeline);
    if (!job) {
      return res.status(404).type('html').send(renderNotFoundPage());
    }

    const pageUrl = getPublicUrl(req, req.originalUrl);
    res.type('html').send(renderJobDetailPage(job, pageUrl));
  } catch (err) {
    console.error(err);
    res.status(500).send('Unable to load the job');
  }
});

export function normalizePdfTarget(rawTargetUrl) {
  let normalized = rawTargetUrl.trim();

  normalized = normalized.replace(
    /^https:__kamuilan\.sbb\.gov\.tr_/i,
    'https://kamuilan.sbb.gov.tr'
  );

  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    return null;
  }

  return normalized.replaceAll('+', '%2B');
}

export function isAllowedPdfUrl(url) {
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  const isAllowedHost = hostname === 'kamuilan.sbb.gov.tr' || hostname.endsWith('.sbb.gov.tr');

  return url.protocol === 'https:' &&
    isAllowedHost &&
    !url.username &&
    !url.password &&
    (!url.port || url.port === '443');
}

// Safe PDF proxy endpoint
app.get('/pdf-viewer', async (req, res) => {
    const rawTargetUrl = req.query.targetUrl;

    if (typeof rawTargetUrl !== 'string' || !rawTargetUrl.trim()) {
        return res.status(400).send('Target URL is required');
    }

    const fullUrl = normalizePdfTarget(rawTargetUrl);
    if (!fullUrl) {
        return res.status(400).send('Invalid target URL');
    }

    try {
        const parsedUrl = new URL(fullUrl);
        if (!isAllowedPdfUrl(parsedUrl)) {
            return res.status(403).send('Access denied: Target domain is not permitted');
        }

        const response = await axios.get(parsedUrl.toString(), {
    httpsAgent: new https.Agent({
        rejectUnauthorized: false
    }),
            headers: {
                'Referer': 'https://kamuilan.sbb.gov.tr/arsiv.aspx',
            },
            responseType: 'arraybuffer',
            timeout: 10000,
            maxContentLength: MAX_PDF_BYTES,
            maxBodyLength: MAX_PDF_BYTES,
            maxRedirects: 0,
            validateStatus: status => status >= 200 && status < 300
        });

        if (response.data.byteLength > MAX_PDF_BYTES) {
            return res.status(413).send('PDF is too large');
        }

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename="proxy-file.pdf"');
        res.setHeader('Content-Length', response.data.byteLength);
        res.send(response.data);
    } catch (error) {
        console.error('PDF proxy error:', error.message);
        res.status(502).send('Unable to fetch the PDF');
    }
});

// Healthcheck
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }

  res.status(404).type('html').send(renderNotFoundPage());
});

export const PORT = process.env.PORT || 3003;
export const MONGODB_URI = process.env.MONGODB_URI;

export async function connectDatabase(databaseUri = MONGODB_URI) {
  if (!databaseUri) {
    throw new Error('MONGODB_URI tanımlı değil (.env dosyanızı kontrol edin)');
  }

  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  await mongoose.connect(databaseUri);
  console.log('✅ Connected to MongoDB');
  return mongoose.connection;
}

export async function startServer({ port = PORT, databaseUri = MONGODB_URI } = {}) {
  await connectDatabase(databaseUri);

  const server = app.listen(port, () => {
    console.log(`✅ Server running on port ${port}`);
  });

  const shutdown = () => {
    console.log('⏳ Shutting down gracefully...');
    server.close(async () => {
      if (mongoose.connection.readyState) {
        await mongoose.connection.close(false);
        console.log('✅ MongoDB connection closed');
      }
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch((err) => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });
}
