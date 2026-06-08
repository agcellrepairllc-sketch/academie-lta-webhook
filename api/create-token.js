/**
 * api/create-token.js
 * Vercel serverless function — generates a pronunciation access token
 * 
 * POST /api/create-token
 * Body: {
 *   email, name, professional_order,
 *   token_type: "trial"|"1hour"|"2hour"|"3hour"|"30day"|"90day",
 *   stripe_session_id (optional)
 * }
 * 
 * Called by webhook.js after Stripe payment, or directly for trials
 */

const FLOW_TOKEN_CREATED = 'https://app.paygogpt.com/api/webhooks/flow/3560/cf1d63393b4c6a3606375dd8a8db90f5ae75080ac0fa0952df6baf0fd16425f1';

// Token config per type
const TOKEN_CONFIG = {
  trial:  { daily_limit_minutes: 10,   days_valid: 7,   sessions: 1    },
  '1hour':{ daily_limit_minutes: 60,   days_valid: 30,  sessions: 999  },
  '2hour':{ daily_limit_minutes: 120,  days_valid: 30,  sessions: 999  },
  '3hour':{ daily_limit_minutes: 180,  days_valid: 30,  sessions: 999  },
  '30day':{ daily_limit_minutes: 30,   days_valid: 30,  sessions: 999  },
  '90day':{ daily_limit_minutes: 30,   days_valid: 90,  sessions: 999  },
};

function generateToken() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const segment = (len) => Array.from(
    { length: len }, 
    () => chars[Math.floor(Math.random() * chars.length)]
  ).join('');
  return `LTA-${segment(4)}-${segment(4)}-${segment(4)}`;
}

function getExpiryDate(daysValid) {
  const d = new Date();
  d.setDate(d.getDate() + daysValid);
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Basic auth check — internal calls only
  const authHeader = req.headers['authorization'] || '';
  const internalKey = process.env.INTERNAL_API_KEY || 'lta-internal-2026';
  if (authHeader !== `Bearer ${internalKey}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { 
    email, name, professional_order, 
    token_type = 'trial',
    stripe_session_id = ''
  } = body;

  if (!email || !name) {
    return res.status(400).json({ error: 'email and name are required' });
  }

  const config = TOKEN_CONFIG[token_type] || TOKEN_CONFIG.trial;
  const token  = generateToken();
  const expires = getExpiryDate(config.days_valid);

  // Trigger PaygoGPT flow to save token to Google Sheets
  try {
    await fetch(FLOW_TOKEN_CREATED, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contactEmail: email,
        contactName:  name,
        data: {
          token,
          token_type,
          professional_order: professional_order || 'General',
          daily_limit_minutes: config.daily_limit_minutes.toString(),
          sessions_remaining:  config.sessions.toString(),
          expires,
          stripe_session_id
        }
      })
    });
    console.log(`Token created and saved: ${token} for ${email}`);
  } catch (err) {
    console.error('Failed to trigger flow:', err.message);
    // Don't fail — still return the token even if sheet write fails
  }

  return res.status(200).json({
    success: true,
    token,
    token_type,
    expires,
    daily_limit_minutes: config.daily_limit_minutes,
    coach_url: `https://agcellrepairllc-sketch.github.io/pronunciation-api/?token=${token}`
  });
}
