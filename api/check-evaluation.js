// api/check-evaluation.js
export const config = { api: { bodyParser: true } };

const PAYGOGPT_API_BASE = 'https://app.paygogpt.com';
const PAYGOGPT_LTA_API_KEY = process.env.PAYGOGPT_LTA_API_KEY;
const EVALUATION_TAG_ID = '737'; // evaluation-achetee tag ID in LTA PaygoGPT account

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Missing email parameter' });

  if (!PAYGOGPT_LTA_API_KEY) {
    return res.status(200).json({ purchased: false });
  }

  try {
    const searchResp = await fetch(
      `${PAYGOGPT_API_BASE}/api/v1/contacts/search?email=${encodeURIComponent(email)}&limit=1`,
      { headers: { 'Authorization': `Bearer ${PAYGOGPT_LTA_API_KEY}`, 'Content-Type': 'application/json' } }
    );

    if (!searchResp.ok) return res.status(200).json({ purchased: false });

    const data = await searchResp.json();
    const contacts = data.contacts || [];
    if (contacts.length === 0) return res.status(200).json({ purchased: false });

    const contactId = contacts[0].publicId || contacts[0].contactId || contacts[0].id;

    const detailResp = await fetch(
      `${PAYGOGPT_API_BASE}/api/v1/contacts/${contactId}`,
      { headers: { 'Authorization': `Bearer ${PAYGOGPT_LTA_API_KEY}`, 'Content-Type': 'application/json' } }
    );

    if (!detailResp.ok) return res.status(200).json({ purchased: false });

    const contactDetail = await detailResp.json();
    const tags = contactDetail.tags || contactDetail.contact?.tags || [];

    // Tags returned as string IDs — check for evaluation-achetee tag ID 737
    const hasPurchased = tags.some(tag => String(tag) === EVALUATION_TAG_ID);

    return res.status(200).json({ purchased: hasPurchased });

  } catch (err) {
    console.error('Check evaluation error:', err.message);
    return res.status(200).json({ purchased: false });
  }
}
