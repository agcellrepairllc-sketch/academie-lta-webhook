const READING_MATERIALS = {
  'fr-CA': {
    'Ingénieur': [
      {
        topic: 'Structures', level: 'B2',
        passage: "Les structures en béton armé doivent résister aux charges permanentes et aux surcharges d'exploitation. L'ingénieur doit vérifier la résistance des matériaux selon les normes du Code de construction du Québec. Les calculs structuraux tiennent compte des conditions climatiques locales, notamment les charges de neige et de vent propres au territoire québécois."
      },
      {
        topic: 'Environnement', level: 'B2',
        passage: "L'évaluation environnementale d'un projet de construction nécessite une analyse approfondie des impacts sur les écosystèmes locaux. L'ingénieur doit proposer des mesures d'atténuation efficaces pour minimiser les perturbations du milieu naturel. Le rapport d'impact doit être soumis au ministère compétent avant le début des travaux."
      }
    ],
    'Médecin': [
      {
        topic: 'Diagnostic', level: 'C1',
        passage: "Le diagnostic différentiel est une étape cruciale dans la pratique médicale. Le médecin doit analyser l'ensemble des symptômes du patient, les résultats des examens complémentaires et l'historique médical pour établir un diagnostic précis. La communication claire avec le patient sur les options thérapeutiques disponibles est fondamentale pour obtenir un consentement éclairé."
      }
    ],
    'Avocat': [
      {
        topic: 'Droit civil', level: 'C1',
        passage: "Le Code civil du Québec constitue le fondement du droit privé québécois et régit les rapports entre les personnes. L'avocat doit maîtriser les dispositions relatives aux contrats, à la responsabilité civile et au droit de la famille pour conseiller efficacement ses clients. L'interprétation des textes législatifs requiert une analyse rigoureuse de la jurisprudence pertinente."
      }
    ],
    'General': [
      {
        topic: 'Communication', level: 'B2',
        passage: "La communication professionnelle en milieu de travail québécois exige clarté, précision et respect des conventions culturelles locales. Lors de réunions ou de présentations, il est important d'adapter son registre de langue selon le contexte et l'auditoire. La capacité d'exprimer des idées complexes de façon concise est une compétence très valorisée dans le monde professionnel."
      }
    ]
  },
  'en-CA': {
    'Ingénieur': [
      {
        topic: 'Structures', level: 'B2',
        passage: "Reinforced concrete structures must withstand permanent loads and live loads according to established engineering standards. The engineer must verify material resistance in compliance with the Quebec Construction Code. Structural calculations take into account local climatic conditions, particularly snow and wind loads specific to the Quebec territory."
      },
      {
        topic: 'Project Management', level: 'C1',
        passage: "Effective management of a construction site relies on rigorous planning of human and material resources. The project engineer must coordinate different trades while respecting established deadlines and budget. Regular communication with the client and stakeholders is essential to ensure the smooth progress of the work."
      }
    ],
    'Médecin': [
      {
        topic: 'Diagnosis', level: 'C1',
        passage: "Differential diagnosis is a crucial step in medical practice. The physician must analyze all patient symptoms, results of complementary examinations, and medical history to establish an accurate diagnosis. Clear communication with the patient about available therapeutic options is fundamental to obtaining informed consent."
      }
    ],
    'Avocat': [
      {
        topic: 'Civil Law', level: 'C1',
        passage: "The Civil Code of Quebec forms the foundation of Quebec private law and governs relations between persons. The lawyer must master provisions relating to contracts, civil liability, and family law to effectively advise clients. Interpretation of legislative texts requires rigorous analysis of relevant case law and jurisprudence."
      }
    ],
    'General': [
      {
        topic: 'Communication', level: 'B2',
        passage: "Effective workplace communication in a Canadian professional environment requires adapting your language register to the context and audience. During meetings or presentations, it is important to structure your ideas clearly and deliver them with appropriate pace and intonation. Active listening and asking clarifying questions demonstrate engagement and professionalism in any setting."
      }
    ]
  }
};

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { order = 'General', language = 'fr-CA' } = req.query;
  const langMaterials = READING_MATERIALS[language] || READING_MATERIALS['fr-CA'];
  const orderKey = Object.keys(langMaterials).find(
    k => k.toLowerCase() === order.toLowerCase()
  ) || 'General';
  const passages = langMaterials[orderKey] || langMaterials['General'];
  const randomPassage = passages[Math.floor(Math.random() * passages.length)];

  return res.status(200).json({
    order: orderKey, language,
    passages: [randomPassage],
    ...randomPassage
  });
}
