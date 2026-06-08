/**
 * api/reading-material.js
 * Vercel serverless function — fetches reading passages for a student
 * 
 * GET /api/reading-material?order=Ingénieur&language=fr-CA&level=1
 * 
 * Returns array of passages from Reading Materials Google Sheet tab
 */

async function getReadingMaterials(order, language, level) {
  try {
    const res = await fetch(
      `https://app.paygogpt.com/api/public/landing-pages/4156/sheet-data?sheet=Reading+Materials`,
      { headers: { 'Accept': 'application/json' } }
    );
    const data = await res.json();
    const rows = data.rows || data.data || [];

    // Filter by order (exact or General fallback), language, active status
    let matches = rows.filter(r => {
      const rowOrder    = (r.Order    || '').trim();
      const rowLang     = (r.Language || '').trim();
      const rowActive   = (r.Active   || '').trim().toLowerCase();
      const rowLevel    = (r.Level    || '').trim();
      
      const orderMatch  = rowOrder.toLowerCase() === order.toLowerCase() ||
                          rowOrder.toLowerCase() === 'general';
      const langMatch   = !language || rowLang === language;
      const activeMatch = rowActive === 'yes' || rowActive === 'true' || rowActive === '1';
      const levelMatch  = !level || rowLevel === level.toString();

      return orderMatch && langMatch && activeMatch && levelMatch;
    });

    // Prefer exact order matches over General
    const exactMatches = matches.filter(r => 
      r.Order.toLowerCase() === order.toLowerCase()
    );
    if (exactMatches.length > 0) matches = exactMatches;

    // Shuffle for variety
    matches.sort(() => Math.random() - 0.5);

    return matches.map(r => ({
      order:              r.Order    || '',
      language:           r.Language || 'fr-CA',
      level:              r.Level    || '1',
      topic:              r.Topic    || '',
      passage:            r.Passage  || '',
      translation_notes:  r['Translation Notes'] || ''
    }));

  } catch (err) {
    console.error('Reading material fetch error:', err.message);
    return [];
  }
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { 
    order    = 'General', 
    language = 'fr-CA', 
    level    = '',
    random   = 'true'
  } = req.query;

  const passages = await getReadingMaterials(order, language, level);

  if (passages.length === 0) {
    // Final fallback — return a default passage
    return res.status(200).json({
      passages: [{
        order:    'General',
        language: 'fr-CA',
        level:    '1',
        topic:    'Introduction',
        passage:  "La langue française est la langue officielle du Québec. Elle est utilisée dans toutes les communications professionnelles et administratives. La maîtrise du français standard québécois est essentielle pour exercer une profession réglementée sur le territoire provincial.",
        translation_notes: 'Focus on: officielle, réglementée, professionnelles'
      }],
      source: 'fallback'
    });
  }

  // If random=true, return just one random passage
  // Otherwise return all
  const result = random === 'true' 
    ? [passages[0]] 
    : passages;

  return res.status(200).json({
    passages: result,
    total:    passages.length,
    order,
    language
  });
}
