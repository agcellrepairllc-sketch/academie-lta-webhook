// api/check-evaluation.js
// Checks if a customer has already purchased an evaluation
// Returns { purchased: true/false }
// Uses PAYGOGPT_LTA_API_KEY — LTA account only (separate from AG Cellular)

export const config = { api: { bodyParser: true } };

const PAYGOGPT_API_BASE = 'https://paymegpt.com';
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
    // Search contact by email
    const searchResp = await fetch(
      `${PAYGOGPT_API_BASE}/api/v1/contacts/search?email=${encodeURIComponent(email)}&limit=1`,
      {
        headers: {
          'Authorization': `Bearer ${PAYGOGPT_LTA_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!searchResp.ok) {
      console.error('PaygoGPT LTA search failed:', searchResp.status, await searchResp.text());
      return res.status(200).json({ purchased: false });
    }

    const data = await searchResp.json();
    const contacts = data.contacts || [];

    if (contacts.length === 0) {
      console.log(`No contact found for ${email}`);
      return res.status(200).json({ purchased: false });
    }

    // Get full contact details to check tags
    const contact = contacts[0];
    const contactId = contact.publicId || contact.contactId || contact.id;

    const detailResp = await fetch(
      `${PAYGOGPT_API_BASE}/api/v1/contacts/${contactId}`,
      {
        headers: {
          'Authorization': `Bearer ${PAYGOGPT_LTA_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!detailResp.ok) {
      console.error('Contact detail fetch failed:', detailResp.status);
      return res.status(200).json({ purchased: false });
    }

    const contactDetail = await detailResp.json();
    const tags = contactDetail.tags || contactDetail.contact?.tags || [];

    const hasPurchased = tags.some(tag => {
      const tagName = typeof tag === 'string' ? tag : (tag.name || tag.label || tag.slug || '');
      return tagName === EVALUATION_TAG;
    });

    console.log(`Check evaluation for ${email}: purchased=${hasPurchased}, tags=${JSON.stringify(tags)}`);
    return res.status(200).json({ purchased: hasPurchased });

  } catch (err) {
    console.error('Check evaluation error:', err.message);
    return res.status(200).json({ purchased: false });
  }
}
