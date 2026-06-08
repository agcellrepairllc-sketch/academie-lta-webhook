/**
 * api/log-session.js
 * Vercel serverless function — logs a completed pronunciation session
 * 
 * POST /api/log-session
 * Body: {
 *   token, email, name, professional_order,
 *   session_type: "exam"|"coaching",
 *   exercise_type: "pronunciation"|"reading_aloud"|"written",
 *   duration_minutes, avg_score, accuracy, fluency,
 *   prosody, completeness, passage_used, weak_words,
 *   session_number, is_trial
 * }
 */

const FLOW_SESSION_LOGGED = 'https://app.paygogpt.com/api/webhooks/flow/3561/233fc3f976f73c0fbc16fa562ab29262e01ca9a5bd131241758087e329ea09a8';
const FLOW_TRIAL_DRIP     = 'https://app.paygogpt.com/api/webhooks/flow/3562/343bd157dab83388a2d54dff48e1bc40402d5a309c81a07ce22c464628818b27';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const {
    token           = '',
    email           = '',
    name            = '',
    professional_order = 'General',
    session_type    = 'exam',
    exercise_type   = 'pronunciation',
    duration_minutes = 0,
    avg_score       = 0,
    accuracy        = 0,
    fluency         = 0,
    prosody         = 0,
    completeness    = 0,
    passage_used    = '',
    weak_words      = '',
    session_number  = 1,
    is_trial        = false,
    language        = 'fr-CA'
  } = body;

  // Skip logging for test tokens
  if (token.startsWith('LTA-TEST-')) {
    console.log('Test mode — skipping session log');
    return res.status(200).json({ success: true, test_mode: true });
  }

  if (!email || !token) {
    return res.status(400).json({ error: 'email and token are required' });
  }

  // Trigger session logged flow → saves to Google Sheets
  try {
    await fetch(FLOW_SESSION_LOGGED, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contactEmail: email,
        contactName:  name,
        data: {
          token,
          professional_order,
          session_type,
          exercise_type,
          duration_minutes: duration_minutes.toString(),
          avg_score:        avg_score.toString(),
          accuracy:         accuracy.toString(),
          fluency:          fluency.toString(),
          prosody:          prosody.toString(),
          completeness:     completeness.toString(),
          passage_used,
          weak_words,
          session_number:   session_number.toString(),
          is_trial:         is_trial ? 'yes' : 'no'
        }
      })
    });
    console.log(`Session logged for ${email}, score: ${avg_score}`);
  } catch (err) {
    console.error('Failed to log session:', err.message);
  }

  // If trial session — trigger drip campaign
  if (is_trial) {
    try {
      await fetch(FLOW_TRIAL_DRIP, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactEmail: email,
          contactName:  name,
          data: {
            professional_order,
            avg_score:   avg_score.toString(),
            weak_words,
            language
          }
        })
      });
      console.log(`Trial drip campaign triggered for ${email}`);
    } catch (err) {
      console.error('Failed to trigger drip:', err.message);
    }
  }

  return res.status(200).json({ success: true });
}
