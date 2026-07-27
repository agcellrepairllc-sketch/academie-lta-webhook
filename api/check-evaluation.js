// api/check-evaluation.js
export const config = { api: { bodyParser: true } };

const PAYGOGPT_API_BASE = 'https://app.paygogpt.com';
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

  if (!PAYGOGPT_LTA_API_KEY) {
    return res.status(200).json({ purchased: false, debug: 'PAYGOGPT_LTA_API_KEY not set' });
  }

  try {
    const searchUrl = `${PAYGOGPT_API_BASE}/api/v1/contacts/search?email=${encodeURIComponent(email)}&limit=1`;

    const searchResp = await fetch(searchUrl, {
      headers: {
        'Authorization': `Bearer ${PAYGOGPT_LTA_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const searchText = await searchResp.text();

    if (!searchResp.ok) {
      return res.status(200).json({ purchased: false, debug: { status: searchResp.status, body: searchText } });
    }

    const data = JSON.parse(searchText);
    const contacts = data.contacts || [];

    if (contacts.length === 0) {
      return res.status(200).json({ purchased: false, debug: 'no contact found' });
    }

    const contact = contacts[0];
    const contactId = contact.publicId || contact.contactId || contact.id;

    // Fetch full contact details to get tags
    const detailResp = await fetch(`${PAYGOGPT_API_BASE}/api/v1/contacts/${contactId}`, {
      headers: {
        'Authorization': `Bearer ${PAYGOGPT_LTA_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const detailText = await detailResp.text();
    const contactDetail = JSON.parse(detailText);
    const tags = contactDetail.tags || contactDetail.contact?.tags || [];

    const hasPurchased = tags.some(tag => {
      const tagName = typeof tag === 'string' ? tag : (tag.name || tag.label || tag.slug || '');
      return tagName === EVALUATION_TAG;
    });

    return res.status(200).json({ 
      purchased: hasPurchased,
      debug: { contactId, tags }
    });

  } catch (err) {
    return res.status(200).json({ purchased: false, debug: { error: err.message } });
  }
}
