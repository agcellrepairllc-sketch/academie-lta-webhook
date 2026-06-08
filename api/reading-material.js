/**
 * api/reading-material.js
 * Vercel serverless function — fetches reading passages for a student
 * 
 * GET /api/reading-material?order=Ingénieur&language=fr-CA&level=1
 * 
 * Passages are loaded from READING_MATERIALS below.
 * Professor adds new passages via the Google Sheet — run sync to update.
 */

// ── Reading materials library ─────────────────────────────────────────────────
// Synced from Google Sheet: Reading Materials tab
// Last sync: 2026-06-08
const READING_MATERIALS = [
  {
    order: "Ingénieur", language: "fr-CA", level: "1", topic: "Structures",
    passage: "Les structures en béton armé doivent résister aux charges permanentes et aux surcharges d'exploitation. L'ingénieur doit vérifier la résistance des matériaux selon les normes du Code de construction du Québec. Les calculs structuraux tiennent compte des conditions climatiques locales, notamment les charges de neige et de vent propres au territoire québécois.",
    translation_notes: "Focus on: béton armé, surcharges, résistance"
  },
  {
    order: "Ingénieur", language: "fr-CA", level: "2", topic: "Thermodynamique",
    passage: "La thermodynamique est une branche de la physique qui étudie les échanges d'énergie sous forme de chaleur et de travail. En ingénierie mécanique, les cycles thermodynamiques permettent de concevoir des systèmes de chauffage, de climatisation et de production d'énergie. Le rendement d'une machine thermique est toujours inférieur à cent pour cent en raison des pertes irréversibles.",
    translation_notes: "Focus on: thermodynamique, rendement, irréversibles"
  },
  {
    order: "Médecin", language: "fr-CA", level: "1", topic: "Neurologie",
    passage: "Le système nerveux central comprend l'encéphale et la moelle épinière. Il coordonne les fonctions vitales de l'organisme et traite les informations sensorielles. Les neurones transmettent les influx nerveux à grande vitesse grâce aux synapses chimiques et électriques. Une lésion médullaire peut entraîner une paralysie partielle ou complète selon le niveau atteint.",
    translation_notes: "Focus on: encéphale, moelle épinière, synapses"
  },
  {
    order: "Avocat", language: "fr-CA", level: "1", topic: "Droit civil",
    passage: "Le droit civil québécois est fondé sur le Code civil du Québec entré en vigueur en mil neuf cent quatre-vingt-quatorze. Il régit les relations entre les personnes physiques et morales sur le territoire provincial. Les contrats doivent respecter les conditions essentielles de formation, notamment le consentement libre et éclairé, la capacité des parties et un objet licite.",
    translation_notes: "Focus on: Code civil, consentement, licite"
  },
  {
    order: "General", language: "fr-CA", level: "1", topic: "Général",
    passage: "La langue française est la langue officielle du Québec. Elle est utilisée dans toutes les communications professionnelles et administratives. La maîtrise du français standard québécois est essentielle pour exercer une profession réglementée sur le territoire provincial. L'Office québécois de la langue française veille au respect et à la promotion de la langue dans les milieux de travail.",
    translation_notes: "Focus on: officielle, réglementée, promotion"
  }
];

function getPassages(order, language, level) {
  // Filter by language and active
  let matches = READING_MATERIALS.filter(r => {
    const orderMatch = r.order.toLowerCase() === order.toLowerCase() ||
                       r.order.toLowerCase() === 'general';
    const langMatch  = !language || r.language === language;
    const levelMatch = !level || r.level === level.toString();
    return orderMatch && langMatch && levelMatch;
  });

  // Prefer exact order matches over General
  const exact = matches.filter(r => r.order.toLowerCase() === order.toLowerCase());
  if (exact.length > 0) matches = exact;

  // Shuffle for variety
  matches.sort(() => Math.random() - 0.5);
  return matches;
}

export default async function handler(req, res) {
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

  const passages = getPassages(order, language, level);

  if (passages.length === 0) {
    return res.status(200).json({
      passages: [{
        order: 'General', language: 'fr-CA', level: '1', topic: 'Introduction',
        passage: "La langue française est la langue officielle du Québec. Elle est utilisée dans toutes les communications professionnelles et administratives. La maîtrise du français standard québécois est essentielle pour exercer une profession réglementée sur le territoire provincial.",
        translation_notes: 'Focus on: officielle, réglementée, professionnelles'
      }],
      source: 'fallback'
    });
  }

  const result = random === 'true' ? [passages[0]] : passages;

  return res.status(200).json({
    passages: result,
    total:    passages.length,
    order,
    language,
    source:   'library'
  });
}
