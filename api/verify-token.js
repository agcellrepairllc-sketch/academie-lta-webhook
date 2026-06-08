/**
 * api/verify-token.js
 * Vercel serverless function — validates a pronunciation access token
 *
 * GET /api/verify-token?token=LTA-TEST-EDGAR
 *
 * Returns: { valid, token_type, name, email, professional_order,
 *             daily_limit_minutes, minutes_used_today, sessions_used,
 *             expires, is_test, reason }
 */

// ── Hardcoded test tokens (bypass all limits) ──────────────────────────────
const TEST_TOKENS = {
  'LTA-TEST-EDGAR': {
    valid:                true,
    is_test:              true,
    token_type:           '30day',
    name:                 'Edgar',
    email:                'edgar@agcellphonerepair.com',
    professional_order:   'Ingénieur',
    daily_limit_minutes:  9999,
    minutes_used_today:   0,
    sessions_used:        0,
    total_minutes_used:   0,
    expires:              '2099-12-31',
    status:               'active',
  },
  'LTA-TEST-PROFESSOR': {
    valid:                true,
    is_test:              true,
    token_type:           '30day',
    name:                 'Professor',
    email:                'professor@academielta.ca',
    professional_order:   'Médecin',
    daily_limit_minutes:  9999,
    minutes_used_today:   0,
    sessions_used:        0,
    total_minutes_used:   0,
    expires:              '2099-12-31',
    status:               'active',
  },
  'LTA-TEST-TRIAL': {
    valid:                true,
    is_test:              true,
    token_type:           'trial',
    name:                 'Trial User',
    email:                'trial@academielta.ca',
    professional_order:   'Avocat',
    daily_limit_minutes:  10,
    minutes_used_today:   0,
    sessions_used:        0,
    total_minutes_used:   0,
    expires:              '2099-12-31',
    status:               'active',
  },
  'LTA-TEST-PAID': {
    valid:                true,
    is_test:              true,
    token_type:           '30day',
    name:                 'Paid User',
    email:                'paid@academielta.ca',
    professional_order:   'Ingénieur',
    daily_limit_minutes:  30,
    minutes_used_today:   0,
    sessions_used:        0,
    total_minutes_used:   0,
    expires:              '2099-12-31',
    status:               'active',
  },
};

// ── Fetch real token from Google Sheets via PaygoGPT public API ────────────
async function lookupTokenInSheets(token) {
  try {
    const res = await fetch(
      `https://app.paygogpt.com/api/public/landing-pages/4156/sheet-data?sheetName=Pronunciation%20Tokens`,
      { headers: { 'Accept': 'application/json' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const rows = data.rows || data.data || [];

    const row = rows.find(r => (r.Token || '').trim() === token.trim());
    if (!row) return null;

    return {
      token:                row.Token               || '',
      email:                row.Email               || '',
      name:                 row.Name                || '',
      professional_order:   row['Professional Order'] || '',
      token_type:           row['Token Type']        || '30day',
      daily_limit_minutes:  parseInt(row['Daily Limit Minutes'] || '30', 10),
      sessions_used:        parseInt(row['Sessions Used']       || '0',  10),
      minutes_used_today:   parseFloat(row['Minutes Used Today']|| '0'),
      total_minutes_used:   parseFloat(row['Total Minutes Used']|| '0'),
      created:              row.Created   || '',
      expires:              row.Expires   || '',
      last_used:            row['Last Used'] || '',
      status:               row.Status    || 'active',
    };
  } catch (err) {
    console.error('Sheet lookup error:', err.message);
    return null;
  }
}

// ── Validate a real token row ──────────────────────────────────────────────
function validateTokenRow(row) {
  if (!row) return { valid: false, reason: 'not_found' };

  if ((row.status || '').toLowerCase() !== 'active') {
    return { valid: false, reason: 'invalid' };
  }

  // Check expiry
  if (row.expires) {
    const expires = new Date(row.expires);
    if (!isNaN(expires) && expires < new Date()) {
      return { valid: false, reason: 'expired' };
    }
  }

  // Check daily limit
  const limit = row.daily_limit_minutes || 30;
  const used  = row.minutes_used_today  || 0;
  if (used >= limit) {
    return { valid: false, reason: 'limit_reached' };
  }

  return { valid: true };
}

// ── Handler ────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ valid: false, reason: 'missing_token' });
  }

  // 1. Check test tokens first
  const testProfile = TEST_TOKENS[token.trim()];
  if (testProfile) {
    return res.status(200).json(testProfile);
  }

  // 2. Look up real token in Sheets
  const row = await lookupTokenInSheets(token);
  const validation = validateTokenRow(row);

  if (!validation.valid) {
    return res.status(200).json({ valid: false, reason: validation.reason });
  }

  // 3. Return valid profile
  return res.status(200).json({
    valid:                true,
    is_test:              false,
    token:                row.token,
    token_type:           row.token_type,
    name:                 row.name,
    email:                row.email,
    professional_order:   row.professional_order,
    daily_limit_minutes:  row.daily_limit_minutes,
    minutes_used_today:   row.minutes_used_today,
    sessions_used:        row.sessions_used,
    total_minutes_used:   row.total_minutes_used,
    expires:              row.expires,
    status:               row.status,
  });
}
