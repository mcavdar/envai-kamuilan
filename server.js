import express from 'express';
import mongoose from 'mongoose';
import compression from 'compression';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

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

const app = express();
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

function parsePositiveInteger(value, fallback, max) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= max ? parsed : null;
}

// Utility to escape regex control characters safely
function escapeRegex(text) {
    return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
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
    validThrough: job.application_end_date || undefined
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
      match["extract_result.job_postings.job_title"] = {
        $regex: escapeRegex(unvanFilter),
        $options: "i"
      };
    }

    if (mezuniyetFilter) {
      const safeMez = escapeRegex(mezuniyetFilter);
      match.$or = match.$or || [];
      match.$or.push(
        { "extract_result.job_postings.mezuniyet": { $regex: safeMez, $options: "i" } },
        { "extract_result.job_postings.qualifications": { $regex: safeMez, $options: "i" } }
      );
    }

    if (keywordFilter) {
      const regex = { $regex: escapeRegex(keywordFilter), $options: "i" };

      const keywordConditions = [
        { "extract_result.announcement_title": regex },
        { "extract_result.organization_name": regex },
        { "extract_result.job_postings.job_title": regex },
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
    return res.status(400).send('Invalid job URL');
  }

  try {
    const [job] = await Job.aggregate(pipeline);
    if (!job) {
      return res.status(404).send('Job not found');
    }

    const pageUrl = getPublicUrl(req, req.originalUrl);
    res.type('html').send(renderJobDetailPage(job, pageUrl));
  } catch (err) {
    console.error(err);
    res.status(500).send('Unable to load the job');
  }
});

function normalizePdfTarget(rawTargetUrl) {
  let normalized = rawTargetUrl.trim();

  normalized = normalized.replace(
    /^https:__kamuilan\.sbb\.gov\.tr_/i,
    'https://kamuilan.sbb.gov.tr/'
  );

  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    return null;
  }

  return normalized.replaceAll('+', '%2B');
}

function isAllowedPdfUrl(url) {
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

// DB bağlantısı ve sunucu başlatma
const PORT = process.env.PORT || 3003;
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('MONGODB_URI tanımlı değil (.env dosyanızı kontrol edin)');
  process.exit(1);
}

mongoose
  .connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  });
  
const server = app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

const shutdown = () => {
  console.log("⏳ Shutting down gracefully...");
  server.close(() => {
    mongoose.connection.close(false, () => {
      console.log("✅ MongoDB connection closed");
      process.exit(0);
    });
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
