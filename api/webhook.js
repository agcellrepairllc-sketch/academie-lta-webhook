import Stripe from 'stripe';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const PAYGOGPT_FLOW_WEBHOOK = process.env.PAYGOGPT_FLOW_WEBHOOK;
const GOOGLE_SHEET_API = 'https://app.paygogpt.com/api/public/landing-pages/4156/sheet-data';

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.S3_BUCKET;

export const config = {
  api: { bodyParser: false },
};

// Generate secure random password
function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const segment = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${segment()}-${segment()}-${segment()}`;
}

// Get raw body for Stripe verification
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Look up professional order from Google Sheets
async function lookupProfessionalOrder(email, name) {
  try {
    const res = await fetch(GOOGLE_SHEET_API);
    const data = await res.json();
    const rows = data.rows || data.data || [];

    // Match by email first
    let matchedRows = rows.filter(r => {
      const rowEmail = r.Email || r.email || r.Courriel || '';
      return rowEmail.toLowerCase() === email.toLowerCase();
    });

    // Fallback: match by name
    if (matchedRows.length === 0 && name) {
      matchedRows = rows.filter(r => {
        const rowName = r.Name || r.name || r.Nom || '';
        return rowName.toLowerCase() === name.toLowerCase();
      });
    }

    if (matchedRows.length > 0) {
      const latest = matchedRows[matchedRows.length - 1];
      return latest['Professional Order'] || latest['Ordre Professionnel'] || '';
    }
  } catch (err) {
    console.error('Error looking up professional order:', err.message);
  }
  return '';
}

// Download PDF from S3
async function downloadPDF(order) {
  // Normalize filename — replace special characters
  const filename = order
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_');

  const key = `manuals/${filename}.pdf`;
  console.log(`Looking for PDF: ${key}`);

  try {
    const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    const response = await s3.send(command);
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (err) {
    console.error(`PDF not found: ${key}`, err.message);
    return null;
  }
}

// Add watermark to PDF
async function watermarkPDF(pdfBuffer, customerName, order, date) {
  const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pages = pdfDoc.getPages();

  const watermarkText = `Matériel d'étude personnel pour : ${customerName}`;

  for (const page of pages) {
    const { width, height } = page.getSize();

    // Diagonal watermark — repeated across page
    const positions = [
      { x: width * 0.1, y: height * 0.25 },
      { x: width * 0.1, y: height * 0.5 },
      { x: width * 0.1, y: height * 0.75 },
    ];

    for (const pos of positions) {
      page.drawText(watermarkText, {
        x: pos.x,
        y: pos.y,
        size: 11,
        font,
        color: rgb(0.7, 0.7, 0.7),
        opacity: 0.35,
        rotate: { type: 'degrees', angle: 35 },
      });
    }

    // Footer on every page
    page.drawText(`Matériel d'étude personnel pour : ${customerName} — Académie LTA — ${date}`, {
      x: 30,
      y: 20,
      size: 7,
      font,
      color: rgb(0.5, 0.5, 0.5),
      opacity: 0.6,
    });
  }

  return await pdfDoc.save();
}

// Upload watermarked PDF to S3 and get pre-signed URL
async function uploadAndGetSignedUrl(pdfBuffer, sessionId, order) {
  const filename = order
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_');

  const key = `watermarked/${sessionId}-${filename}.pdf`;

  // Upload to S3
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: pdfBuffer,
    ContentType: 'application/pdf',
  }));

  // Generate pre-signed URL (48 hours)
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  const url = await getSignedUrl(s3, command, { expiresIn: 172800 });

  console.log(`Pre-signed URL generated for: ${key}`);
  return url;
}

// Main handler
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
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
    const date = new Date().toLocaleDateString('fr-CA');

    console.log('Payment confirmed:', { customerEmail, customerName, sessionId });

    // Look up professional order
    const professionalOrder = await lookupProfessionalOrder(customerEmail, customerName);
    const productLabel = professionalOrder ? `Manuel OQLF — ${professionalOrder}` : 'Manuel OQLF';

    console.log('Professional order:', professionalOrder);

    // Generate unique password
    const pdfPassword = generatePassword();

    // PDF delivery
    let downloadUrl = null;
    let pdfAvailable = false;

    if (professionalOrder) {
      const pdfBuffer = await downloadPDF(professionalOrder);

      if (pdfBuffer) {
        console.log('PDF found, watermarking...');
        const watermarked = await watermarkPDF(pdfBuffer, customerName, professionalOrder, date);
        downloadUrl = await uploadAndGetSignedUrl(watermarked, sessionId, professionalOrder);
        pdfAvailable = true;
        console.log('PDF watermarked and uploaded successfully');
      } else {
        console.log('PDF not found for order:', professionalOrder);
      }
    }

    // Trigger PaygoGPT Flow 3277
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
            download_url: downloadUrl || '',
            pdf_password: pdfPassword,
            pdf_available: pdfAvailable ? 'yes' : 'no',
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
