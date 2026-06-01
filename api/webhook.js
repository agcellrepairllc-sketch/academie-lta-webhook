import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const PAYGOGPT_FLOW_WEBHOOK = process.env.PAYGOGPT_FLOW_WEBHOOK;
const GOOGLE_SHEET_API = 'https://app.paygogpt.com/api/public/landing-pages/4156/sheet-data';

export const config = {
  api: { bodyParser: false },
};

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function lookupProfessionalOrder(email, name) {
  try {
    const res = await fetch(GOOGLE_SHEET_API);
    const data = await res.json();
    
    // Log full response to debug
    console.log('Sheet API response:', JSON.stringify(data).substring(0, 500));
    
    const rows = data.rows || data.data || data || [];
    console.log('Rows count:', rows.length);
    
    if (rows.length > 0) {
      console.log('First row keys:', Object.keys(rows[0]));
      console.log('First row:', JSON.stringify(rows[0]));
    }

    // Try matching by email (case insensitive)
    let matchedRows = rows.filter(r => {
      const rowEmail = r.Email || r.email || r.Courriel || r.courriel || '';
      return rowEmail.toLowerCase() === email.toLowerCase();
    });

    // Fallback: match by name
    if (matchedRows.length === 0 && name) {
      matchedRows = rows.filter(r => {
        const rowName = r.Name || r.name || r.Nom || r.nom || '';
        return rowName.toLowerCase() === name.toLowerCase();
      });
    }

    console.log('Matched rows:', matchedRows.length);

    if (matchedRows.length > 0) {
      const latest = matchedRows[matchedRows.length - 1];
      const order = latest['Professional Order'] || latest['professional_order'] || 
                    latest['Ordre Professionnel'] || latest['ordre_professionnel'] || '';
      console.log('Found professional order:', order);
      return order;
    }
  } catch (err) {
    console.error('Error looking up professional order:', err.message);
  }
  return '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    const customerEmail = session.customer_email || session.customer_details?.email || '';
    const customerName = session.customer_details?.name || '';
    const amountCents = session.amount_total || 0;
    const sessionId = session.id;
    const currency = session.currency?.toUpperCase() || 'CAD';

    console.log('Payment confirmed:', { customerEmail, customerName, amountCents, sessionId });

    // Look up professional order from Google Sheets
    const professionalOrder = await lookupProfessionalOrder(customerEmail, customerName);
    const productLabel = professionalOrder ? `Manuel OQLF — ${professionalOrder}` : 'Manuel OQLF';

    console.log('Final professional order:', professionalOrder);

    try {
      const response = await fetch(PAYGOGPT_FLOW_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactEmail: customerEmail,
          contactName: customerName,
          data: {
            product_label: productLabel,
            professional_order: professionalOrder,
            amount_cents: amountCents,
            stripe_session_id: sessionId,
            currency: currency,
          },
        }),
      });

      if (!response.ok) {
        console.error('PaygoGPT flow trigger failed:', await response.text());
      } else {
        console.log('PaygoGPT Flow 3277 triggered successfully');
      }
    } catch (err) {
      console.error('Error triggering PaygoGPT flow:', err.message);
    }
  }

  res.status(200).json({ received: true });
}
