import { GoogleAuth } from 'google-auth-library';
import { google } from 'googleapis';

const SHEET_ID = '1vFIv6TDkQphBNVS8Hc4sUOIA7ZLs2sq8d3sEteST3PI';
const SHEET_TAB = 'Orders';

export const config = { api: { bodyParser: true } };

async function getSheetsClient() {
  const keyJson = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const auth = new GoogleAuth({
    credentials: keyJson,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const authClient = await auth.getClient();
  return google.sheets({ version: 'v4', auth: authClient });
}

export default async function handler(req, res) {
  // Allow CORS from PaygoGPT landing pages
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, name, ordre, product, amount } = req.body;

  if (!email || !ordre) {
    return res.status(400).json({ error: 'Missing required fields: email and ordre' });
  }

  try {
    const sheets = await getSheetsClient();
    const date = new Date().toLocaleDateString('fr-CA');

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_TAB}!A:G`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[date, email, name || '', ordre, product || '', amount || '', '']],
      },
    });

    console.log(`Order stored: ${email} — ${ordre} — ${product}`);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Sheet write error:', err.message);
    return res.status(500).json({ error: 'Failed to store order' });
  }
}
