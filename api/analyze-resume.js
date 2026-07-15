const openAiModel = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

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

function extractKeywordsFromText(text) {
  const stopWords = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'you', 'your', 'are', 'our', 'from', 'will', 'have', 'has',
    'role', 'team', 'teams', 'work', 'working', 'years', 'year', 'experience', 'skills', 'ability',
    'responsible', 'responsibilities', 'requirements', 'preferred', 'bonus', 'must', 'should', 'including',
    'looking', 'about', 'also', 'they', 'them', 'their', 'into', 'over', 'under', 'using', 'within', 'across',
    'candidate', 'candidates'
  ]);

  const words = tokenize(text)
    .map(word => word.replace(/^[^a-z0-9]+|[^a-z0-9+.#/-]+$/gi, ''))
    .filter(word => word.length > 2 && !stopWords.has(word));

  const pairCounts = new Map();
  for (let index = 0; index < words.length - 1; index += 1) {
    const pair = `${words[index]} ${words[index + 1]}`;
    pairCounts.set(pair, (pairCounts.get(pair) || 0) + 1);
  }

  return [...new Set([
    ...[...pairCounts.entries()].filter(([, count]) => count > 1).map(([phrase]) => phrase),
    ...words.slice(0, 20)
  ])].slice(0, 14);
}

function analyzeHeuristically(resumeText, role, keywordString, jobDescription) {
  const keywords = String(keywordString || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  const jobKeywords = extractKeywordsFromText(jobDescription || '');
  const fallbackKeywords = [...new Set([
    ...jobKeywords,
    ...keywords,
    ...(keywords.length ? [] : ['impact', 'leadership', 'analysis', 'communication'])
  ])];
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
    jobDescription: normalize(jobDescription || ''),
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
    jobDescription: fallback.jobDescription,
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

module.exports = async function handler(request, response) {
  if (request.method !== 'POST') {
    response.statusCode = 405;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  try {
    const body = await new Promise((resolve, reject) => {
      const chunks = [];
      request.on('data', chunk => chunks.push(chunk));
      request.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
        } catch (error) {
          reject(error);
        }
      });
      request.on('error', reject);
    });

    const resumeText = normalize(body.resumeText);
    const role = String(body.targetRole || 'Target role').trim();
    const keywords = String(body.keywords || '');
    const jobDescription = normalize(body.jobDescription || '');

    if (!resumeText) {
      response.statusCode = 400;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ error: 'resumeText is required' }));
      return;
    }

    const fallback = analyzeHeuristically(resumeText, role, keywords, jobDescription);
    const openAiKey = process.env.OPENAI_API_KEY || '';

    if (!openAiKey) {
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify(fallback));
      return;
    }

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
      jobDescription,
      resumeText
    });

    const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
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

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      throw new Error(`OpenAI API error: ${aiResponse.status} ${errorText}`);
    }

    const data = await aiResponse.json();
    const content = data?.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(String(content).trim());
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify(normalizeAiResponse(parsed, fallback)));
  } catch (error) {
    response.statusCode = 500;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify({ error: error.message || 'Invalid request' }));
  }
}
