// Reading Materials — ~45 words per passage, comfortable 20-25 second read
const READING_MATERIALS = {
  'fr-CA': {
    'Ingénieur': [
      {
        topic: 'Structures', level: 'B2',
        passage: "Les structures en béton armé doivent résister aux charges permanentes et aux surcharges d'exploitation. L'ingénieur vérifie la résistance des matériaux selon les normes du Code de construction du Québec, en tenant compte des charges de neige et de vent propres au territoire québécois."
      },
      {
        topic: 'Environnement', level: 'B2',
        passage: "L'évaluation environnementale d'un projet de construction nécessite une analyse des impacts sur les écosystèmes locaux. L'ingénieur propose des mesures d'atténuation pour minimiser les perturbations du milieu naturel. Le rapport d'impact est soumis au ministère compétent avant le début des travaux."
      },
      {
        topic: 'Gestion de projet', level: 'C1',
        passage: "La gestion efficace d'un chantier repose sur une planification rigoureuse des ressources humaines et matérielles. L'ingénieur coordonne les différents corps de métier tout en respectant les délais et le budget établis. La communication régulière avec le client est essentielle au bon déroulement des travaux."
      },
      {
        topic: 'Géotechnique', level: 'B2',
        passage: "L'étude géotechnique du sol est indispensable avant toute construction au Québec. Les ingénieurs analysent la capacité portante du terrain et les risques de tassement. Les fondations sont dimensionnées en fonction des résultats obtenus lors des forages et des essais de laboratoire."
      }
    ],
    'Médecin': [
      {
        topic: 'Diagnostic', level: 'C1',
        passage: "Le diagnostic différentiel est une étape cruciale en pratique médicale. Le médecin analyse les symptômes du patient, les résultats des examens complémentaires et l'historique médical. La communication claire sur les options thérapeutiques est fondamentale pour obtenir un consentement éclairé."
      },
      {
        topic: 'Pharmacologie', level: 'C1',
        passage: "La prescription médicamenteuse au Québec est encadrée par des protocoles stricts visant la sécurité des patients. Le médecin tient compte des interactions médicamenteuses et des contre-indications. La révision régulière de l'ordonnance permet d'ajuster le traitement selon l'évolution du patient."
      },
      {
        topic: 'Urgences', level: 'C1',
        passage: "La prise en charge aux urgences exige une évaluation rapide et précise de l'état du patient. Le médecin doit prioriser les interventions selon le niveau de gravité clinique. Une communication efficace avec l'équipe soignante est essentielle pour assurer la continuité des soins."
      }
    ],
    'Avocat': [
      {
        topic: 'Droit civil', level: 'C1',
        passage: "Le Code civil du Québec constitue le fondement du droit privé et régit les rapports entre les personnes. L'avocat maîtrise les dispositions relatives aux contrats et à la responsabilité civile. L'interprétation des textes législatifs requiert une analyse rigoureuse de la jurisprudence pertinente."
      },
      {
        topic: 'Procédure', level: 'C1',
        passage: "Le nouveau Code de procédure civile favorise la résolution des conflits par des modes alternatifs avant de recourir aux tribunaux. L'avocat guide son client à travers les différentes étapes du processus judiciaire. Le respect des délais stricts imposés par la loi est une obligation professionnelle."
      },
      {
        topic: 'Droit des affaires', level: 'C1',
        passage: "La rédaction d'un contrat commercial requiert une attention particulière aux clauses de responsabilité et de résiliation. L'avocat conseille son client sur les risques juridiques liés aux transactions d'affaires. Une clause de confidentialité bien rédigée protège les intérêts commerciaux des parties."
      }
    ],
    'Architecte': [
      {
        topic: 'Conception', level: 'B2',
        passage: "La conception architecturale intègre des considérations esthétiques, fonctionnelles et environnementales. L'architecte doit respecter les règlements d'urbanisme en vigueur dans chaque municipalité québécoise. Le choix des matériaux influence directement la durabilité et l'efficacité énergétique du bâtiment."
      },
      {
        topic: 'Réglementation', level: 'C1',
        passage: "Le Code national du bâtiment encadre la construction au Canada et établit des normes minimales de sécurité. L'architecte est responsable de la conformité des plans avec les exigences réglementaires applicables. Les permis de construction doivent être obtenus auprès des autorités municipales compétentes."
      }
    ],
    'General': [
      {
        topic: 'Communication', level: 'B2',
        passage: "La communication professionnelle en milieu québécois exige clarté et respect des conventions culturelles locales. Il est important d'adapter son registre de langue selon le contexte et l'auditoire. La capacité d'exprimer des idées complexes de façon concise est très valorisée dans le monde professionnel."
      },
      {
        topic: 'Français québécois', level: 'B2',
        passage: "Le français québécois se distingue par ses particularités linguistiques qui reflètent l'histoire unique de la province. La prononciation et certaines expressions idiomatiques diffèrent du français standard. La maîtrise de ces nuances est essentielle pour communiquer efficacement dans un contexte professionnel au Québec."
      },
      {
        topic: 'Milieu de travail', level: 'B1',
        passage: "Le milieu de travail québécois valorise le respect, la collaboration et l'ouverture aux différentes cultures. Les réunions d'équipe favorisent l'échange d'idées et la prise de décision collective. Une bonne maîtrise du français facilite l'intégration professionnelle dans la province."
      }
    ]
  },
  'en-CA': {
    'Ingénieur': [
      {
        topic: 'Structures', level: 'B2',
        passage: "Reinforced concrete structures must withstand permanent and live loads according to engineering standards. The engineer verifies material resistance in compliance with the Quebec Construction Code. Structural calculations account for local climatic conditions, including snow and wind loads specific to the Quebec territory."
      },
      {
        topic: 'Project Management', level: 'C1',
        passage: "Effective construction site management relies on rigorous planning of human and material resources. The project engineer coordinates different trades while respecting established deadlines and budget. Regular communication with the client and stakeholders is essential to ensure smooth progress of the work."
      },
      {
        topic: 'Environment', level: 'B2',
        passage: "Environmental assessment of a construction project requires thorough analysis of impacts on local ecosystems. The engineer must propose effective mitigation measures to minimize disruptions to the natural environment. The impact report must be submitted to the competent ministry before work begins."
      }
    ],
    'Médecin': [
      {
        topic: 'Diagnosis', level: 'C1',
        passage: "Differential diagnosis is a crucial step in medical practice. The physician analyzes patient symptoms, examination results, and medical history to establish an accurate diagnosis. Clear communication about available therapeutic options is fundamental to obtaining informed consent from the patient."
      },
      {
        topic: 'Patient Care', level: 'C1',
        passage: "Medication prescription in Quebec is governed by strict protocols designed to ensure patient safety. The physician must consider drug interactions, contraindications, and potential side effects. Regular review of the prescription allows treatment adjustments based on the evolution of the patient's condition."
      }
    ],
    'Avocat': [
      {
        topic: 'Civil Law', level: 'C1',
        passage: "The Civil Code of Quebec forms the foundation of Quebec private law and governs relations between persons. The lawyer must master provisions relating to contracts, civil liability, and family law. Interpretation of legislative texts requires rigorous analysis of relevant case law and jurisprudence."
      },
      {
        topic: 'Procedure', level: 'C1',
        passage: "The Code of Civil Procedure favors conflict resolution through alternative methods before resorting to the courts. The lawyer guides their client through the various stages of the judicial process. Strict deadlines imposed by law must be respected throughout all legal proceedings."
      }
    ],
    'Architecte': [
      {
        topic: 'Design', level: 'B2',
        passage: "Architectural design integrates aesthetic, functional, and environmental considerations into every project. The architect must comply with urban planning regulations in effect in each Quebec municipality. The choice of materials directly influences the durability and energy efficiency of the building."
      }
    ],
    'General': [
      {
        topic: 'Communication', level: 'B2',
        passage: "Effective workplace communication in a Canadian professional environment requires adapting your language to the context and audience. During meetings and presentations, structure your ideas clearly and speak at an appropriate pace. Active listening and asking clarifying questions demonstrate engagement and professionalism."
      },
      {
        topic: 'Professional Skills', level: 'B2',
        passage: "Canadian workplaces value respect, collaboration, and openness to diverse perspectives. Team meetings encourage the exchange of ideas and collective decision making. Strong communication skills facilitate professional integration and career advancement in any field across the country."
      },
      {
        topic: 'Quebec English', level: 'B1',
        passage: "English is widely spoken in Quebec's professional and business environments, particularly in Montreal. Many workplaces operate in both official languages, requiring bilingual communication skills. Clear and professional English expression opens doors to career opportunities across the province and country."
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
    order: orderKey,
    language,
    passages: [randomPassage],
    ...randomPassage
  });
}
