// api/check-evaluation.js
// Checks if a customer has already purchased an evaluation
// Returns { purchased: true/false }
// Uses PAYGOGPT_LTA_API_KEY — LTA account only (separate from AG Cellular)

export const config = { api: { bodyParser: true } };

const PAYGOGPT_API_BASE = 'https://app.paymegpt.com/api';
const PAYGOGPT_LTA_API_KEY = process.env.PAYGOGPT_LTA_API_KEY;
const EVALUATION_TAG = 'evaluation-achetee';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Missing email parameter' });

  try {
    const searchResp = await fetch(
      `${PAYGOGPT_API_BASE}/contacts?email=${encodeURIComponent(email)}&limit=1`,
      {
        headers: {
          'Authorization': `Bearer ${PAYGOGPT_LTA_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!searchResp.ok) {
      console.error('PaygoGPT LTA search failed:', searchResp.status);
      return res.status(200).json({ purchased: false });
    }

    const data = await searchResp.json();
    const contacts = data.contacts || data.data || [];

    if (contacts.length === 0) {
      return res.status(200).json({ purchased: false });
    }

    const contact = contacts[0];
    const tags = contact.tags || [];

    const hasPurchased = tags.some(tag =>
      (typeof tag === 'string' ? tag : tag.name || tag.label || '') === EVALUATION_TAG
    );

    console.log(`Check evaluation for ${email}: purchased=${hasPurchased}`);
    return res.status(200).json({ purchased: hasPurchased });

  } catch (err) {
    console.error('Check evaluation error:', err.message);
    return res.status(200).json({ purchased: false });
  }
}
