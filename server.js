const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const rootDir = __dirname;
const port = Number(process.env.PORT || 3000);
const openAiKey = process.env.OPENAI_API_KEY || '';
const openAiModel = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalize(text) {
  return String(text || '').replace(/\r\n/g, '\n').trim();
}

function tokenize(text) {
  return normalize(text).toLowerCase().match(/[a-z0-9+#.-]+/g) || [];
}

function countMatches(text, terms) {
  const lower = normalize(text).toLowerCase();
  return terms.filter(term => lower.includes(term.toLowerCase()));
}

function analyzeHeuristically(resumeText, role, keywordString) {
  const keywords = String(keywordString || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  const fallbackKeywords = keywords.length ? keywords : ['impact', 'leadership', 'analysis', 'communication'];
  const words = tokenize(resumeText);
  const lower = normalize(resumeText).toLowerCase();
  const matched = countMatches(lower, fallbackKeywords);
  const missing = fallbackKeywords.filter(keyword => !matched.includes(keyword));
  const wordCount = words.length;
  const sectionCount = ['experience', 'education', 'skills', 'projects', 'summary', 'certifications']
    .filter(section => new RegExp(`^\\s*${section}\\b`, 'mi').test(resumeText)).length;
  const contactScore = [
    /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/.test(resumeText),
    /\b(\+?\d[\d\s().-]{7,}\d)\b/.test(resumeText),
    /\b(linkedin\.com|github\.com|portfolio|website)\b/i.test(resumeText)
  ].filter(Boolean).length;
  const grammarFlags = [];
  if ((resumeText.match(/\s{2,}/g) || []).length) grammarFlags.push('Repeated spacing found.');
  if (wordCount < 120) grammarFlags.push('Resume appears very short for a full application.');
  if (contactScore < 2) grammarFlags.push('Contact section looks incomplete.');
  if (!sectionCount) grammarFlags.push('No clear resume sections detected.');
  const matchedPercent = Math.round((matched.length / Math.max(fallbackKeywords.length, 1)) * 100);
  const atsScore = clamp(
    Math.round(
      matchedPercent * 0.45 +
      Math.min(20, sectionCount * 5) +
      contactScore * 6 +
      (wordCount >= 180 && wordCount <= 900 ? 18 : wordCount >= 100 ? 10 : 3)
    ),
    0,
    100
  );
  const grammarScore = clamp(100 - grammarFlags.length * 12, 0, 100);
  const readiness = Math.round((atsScore + grammarScore) / 2);
  const suggestions = [];
  if (missing.length) suggestions.push('Add the missing role-specific keywords naturally into accomplishments and skills.');
  if (sectionCount < 3) suggestions.push('Use clear section headings like Experience, Skills, and Education.');
  if (contactScore < 2) suggestions.push('Add email, phone, and LinkedIn or portfolio links.');
  if (!suggestions.length) suggestions.push('Strong overall draft — add quantified impact where possible.');

  return {
    source: 'fallback',
    role,
    keywords: fallbackKeywords,
    wordCount,
    atsScore,
    matched,
    missing,
    matchedPercent,
    grammarScore,
    readiness,
    grammarFlags,
    suggestions,
    summary: `${wordCount} words • ${sectionCount} detected sections • ${contactScore}/3 contact signals found`
  };
}

function normalizeAiResponse(raw, fallback) {
  const atsScore = clamp(Number(raw?.atsScore ?? fallback.atsScore) || fallback.atsScore, 0, 100);
  const matched = Array.isArray(raw?.matched) ? raw.matched.filter(Boolean).map(String) : fallback.matched;
  const missing = Array.isArray(raw?.missing) ? raw.missing.filter(Boolean).map(String) : fallback.missing;
  const matchedPercent = clamp(Number(raw?.matchedPercent ?? Math.round((matched.length / Math.max(fallback.keywords.length, 1)) * 100)) || 0, 0, 100);
  const grammarScore = clamp(Number(raw?.grammarScore ?? fallback.grammarScore) || fallback.grammarScore, 0, 100);
  const readiness = clamp(Number(raw?.readiness ?? Math.round((atsScore + grammarScore) / 2)) || 0, 0, 100);
  const grammarFlags = Array.isArray(raw?.grammarFlags) ? raw.grammarFlags.filter(Boolean).map(String) : fallback.grammarFlags;
  const suggestions = Array.isArray(raw?.suggestions) ? raw.suggestions.filter(Boolean).map(String) : fallback.suggestions;
  const summary = typeof raw?.summary === 'string' && raw.summary.trim() ? raw.summary.trim() : fallback.summary;

  return {
    source: 'ai',
    role: fallback.role,
    keywords: fallback.keywords,
    wordCount: fallback.wordCount,
    atsScore,
    matched,
    missing,
    matchedPercent,
    grammarScore,
    readiness,
    grammarFlags,
    suggestions,
    summary
  };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

async function extractOpenAiJson(resumeText, role, keywords, fallback) {
  const systemPrompt = [
    'You are an expert resume reviewer and ATS analyst.',
    'Return ONLY valid JSON, no markdown, no code fences.',
    'Use the exact keys: atsScore, matched, missing, matchedPercent, grammarScore, readiness, grammarFlags, suggestions, summary.',
    'Scores are integers from 0 to 100.',
    'matched and missing must be arrays of short keyword phrases.',
    'grammarFlags and suggestions must be concise, practical bullets.',
    'summary should be one sentence with the strongest hiring signal and biggest gap.'
  ].join(' ');

  const userPrompt = JSON.stringify({
    targetRole: role,
    priorityKeywords: keywords,
    resumeText
  });

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openAiKey}`
    },
    body: JSON.stringify({
      model: openAiModel,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content || '{}';
  const trimmed = String(content).trim();
  const parsed = JSON.parse(trimmed);
  return normalizeAiResponse(parsed, fallback);
}

async function handleAnalyzeResume(req, res) {
  try {
    const body = await readBody(req);
    const resumeText = normalize(body.resumeText);
    const role = String(body.targetRole || 'Target role').trim();
    const keywords = String(body.keywords || '');

    if (!resumeText) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'resumeText is required' }));
      return;
    }

    const fallback = analyzeHeuristically(resumeText, role, keywords);

    if (!openAiKey) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(fallback));
      return;
    }

    try {
      const aiResult = await extractOpenAiJson(resumeText, role, keywords, fallback);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(aiResult));
    } catch (error) {
      const degraded = {
        ...fallback,
        source: 'fallback',
        grammarFlags: [...fallback.grammarFlags, 'AI request failed; showing local analysis instead.']
      };
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(degraded));
      console.error(error);
    }
  } catch (error) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: error.message || 'Invalid request' }));
  }
}

async function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = mimeTypes[ext] || 'application/octet-stream';
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });
  res.writeHead(200, { 'Content-Type': mimeType });
  stream.pipe(res);
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'POST' && requestUrl.pathname === '/api/analyze-resume') {
    await handleAnalyzeResume(req, res);
    return;
  }

  let relativePath = requestUrl.pathname;
  if (relativePath === '/') relativePath = '/index.html';

  const filePath = path.resolve(rootDir, `.${relativePath}`);
  if (!filePath.startsWith(`${rootDir}${path.sep}`) && filePath !== path.join(rootDir, 'index.html')) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  try {
    await fsp.access(filePath);
    await serveFile(res, filePath);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});

server.listen(port, () => {
  console.log(`AI Resume Analyzer running at http://localhost:${port}`);
  if (!openAiKey) {
    console.log('OPENAI_API_KEY is not set; the app will use local fallback analysis.');
  }
});
