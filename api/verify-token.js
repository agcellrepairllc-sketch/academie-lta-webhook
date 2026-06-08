/**
 * api/verify-token.js
 * Vercel serverless function — validates a pronunciation access token
 * 
 * GET /api/verify-token?token=LTA-xxxx
 * 
 * Returns student profile + access limits
 * Called by the GitHub page on load
 */

const SHEET_ID = '1lSSExnpJNB6MEvKEgeaN7yaX3QGVjtXdl14hV9tirrM';
const PAYGOGPT_SHEET_API = `https://app.paygogpt.com/api/public/landing-pages/4156/sheet-data`;

// ── Test tokens — bypass all limits ──────────────────────────────────────────
const TEST_TOKENS = {
  'LTA-TEST-EDGAR': {
    student_name:        'Edgar (Test)',
    email:               'test@academielta.ca',
    professional_order:  'Ingénieur',
    token_type:          'test',
    daily_limit_minutes: 9999,
    sessions_remaining:  9999,
    expires:             '2099-12-31',
    test_mode:           true
  },
  'LTA-TEST-PROFESSOR': {
    student_name:        'Professor (Test)',
    email:               'professor@academielta.ca',
    professional_order:  'Médecin',
    token_type:          'test',
    daily_limit_minutes: 9999,
    sessions_remaining:  9999,
    expires:             '2099-12-31',
    test_mode:           true
  },
  'LTA-TEST-TRIAL': {
    student_name:        'Trial Student (Test)',
    email:               'trial@academielta.ca',
    professional_order:  'Avocat',
    token_type:          'trial',
    daily_limit_minutes: 10,
    sessions_remaining:  1,
    expires:             '2099-12-31',
    test_mode:           true
  },
  'LTA-TEST-PAID': {
    student_name:        'Paid Student (Test)',
    email:               'paid@academielta.ca',
    professional_order:  'Ingénieur',
    token_type:          '30day',
    daily_limit_minutes: 30,
    sessions_remaining:  999,
    expires:             '2099-12-31',
    test_mode:           true
  }
};

async function getTokenFromSheet(token) {
  try {
    // Use PaygoGPT sheet search endpoint
    const res = await fetch(
      `https://app.paygogpt.com/api/public/landing-pages/4156/sheet-data?sheetName=Pronunciation%20Tokens`,
      { headers: { 'Accept': 'application/json' } }
    );
    const data = await res.json();
    const data = await res.json();
    const rows = data.rows || data.data || [];
    
    const row = rows.find(r => 
      (r.Token || '').trim().toUpperCase() === token.toUpperCase()
    );
    return row || null;
  } catch (err) {
    console.error('Sheet lookup error:', err.message);
    return null;
  }
}

function isExpired(expiryDateStr) {
  if (!expiryDateStr) return false;
  const expiry = new Date(expiryDateStr);
  return expiry < new Date();
}

function minutesUsedToday(lastUsed, minutesUsedToday) {
  if (!lastUsed) return 0;
  const last = new Date(lastUsed);
  const now  = new Date();
  // Reset daily counter if last use was on a different day (Quebec time EST/EDT)
  const lastDay = last.toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
  const today   = now.toLocaleDateString('en-CA',  { timeZone: 'America/Toronto' });
  if (lastDay !== today) return 0;
  return parseFloat(minutesUsedToday) || 0;
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ valid: false, error: 'Token required' });
  }

  // ── Check test tokens first ───────────────────────────────────────────────
  const testData = TEST_TOKENS[token.toUpperCase()];
  if (testData) {
    return res.status(200).json({
      valid:              true,
      ...testData,
      minutes_used_today: 0,
      total_sessions:     0,
      message:            'TEST MODE — No limits apply'
    });
  }

  // ── Look up real token in Google Sheets ───────────────────────────────────
  const row = await getTokenFromSheet(token);

  if (!row) {
    return res.status(200).json({ valid: false, error: 'Token not found' });
  }

  // Check status
  if ((row.Status || '').toLowerCase() !== 'active') {
    return res.status(200).json({ valid: false, error: 'Token is no longer active' });
  }

  // Check expiry
  if (isExpired(row.Expires)) {
    return res.status(200).json({ valid: false, error: 'Token has expired', expired: true });
  }

  // Check trial already used
  const sessionsUsed = parseInt(row['Sessions Used'] || '0');
  const tokenType    = (row['Token Type'] || '').toLowerCase();
  if (tokenType === 'trial' && sessionsUsed >= 1) {
    return res.status(200).json({ 
      valid:    false, 
      error:    'Free trial already used',
      trial_expired: true,
      student_name: row.Name,
      professional_order: row['Professional Order']
    });
  }

  // Calculate today's usage
  const usedToday     = minutesUsedToday(row['Last Used'], row['Minutes Used Today']);
  const dailyLimit    = parseInt(row['Daily Limit Minutes'] || '9999');
  const minutesLeft   = Math.max(0, dailyLimit - usedToday);

  if (minutesLeft <= 0) {
    return res.status(200).json({ 
      valid: false, 
      error: 'Daily practice limit reached. Come back tomorrow!',
      daily_limit_reached: true,
      student_name: row.Name
    });
  }

  // All good — return student profile
  return res.status(200).json({
    valid:               true,
    test_mode:           false,
    student_name:        row.Name || '',
    email:               row.Email || '',
    professional_order:  row['Professional Order'] || 'General',
    token_type:          tokenType,
    daily_limit_minutes: dailyLimit,
    minutes_used_today:  usedToday,
    minutes_remaining_today: minutesLeft,
    sessions_used:       sessionsUsed,
    total_minutes_used:  parseFloat(row['Total Minutes Used'] || '0'),
    expires:             row.Expires || '',
    status:              row.Status || 'active'
  });
}
