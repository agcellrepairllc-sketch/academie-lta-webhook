import Stripe from 'stripe';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const PAYGOGPT_FLOW_WEBHOOK = process.env.PAYGOGPT_FLOW_WEBHOOK;
const GOOGLE_SHEET_API = 'https://app.paygogpt.com/api/public/landing-pages/4156/sheet-data';

// Debug AWS credentials
const AWS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || '';
const AWS_SECRET = process.env.AWS_SECRET_ACCESS_KEY || '';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const BUCKET = process.env.S3_BUCKET || 'academielta';

console.log('AWS Config check:', {
  keyIdLength: AWS_KEY_ID.length,
  keyIdPrefix: AWS_KEY_ID.substring(0, 4),
  secretLength: AWS_SECRET.length,
  region: AWS_REGION,
  bucket: BUCKET,
});

const s3 = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_KEY_ID,
    secretAccessKey: AWS_SECRET,
  },
});

export const config = {
  api: { bodyParser: false },
};

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const segment = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${segment()}-${segment()}-${segment()}`;
}

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
    const rows = data.rows || data.data || [];

    console.log(`Total rows in sheet: ${rows.length}`);

    let matchedRows = rows.filter(r => {
      const rowEmail = r.Email || r.email || r.Courriel || '';
      const rowOrder = r['Professional Order'] || r['Ordre Professionnel'] || '';
      return rowEmail.toLowerCase() === email.toLowerCase() && rowOrder.trim() !== '';
    });

    if (matchedRows.length === 0 && name) {
      matchedRows = rows.filter(r => {
        const rowName = r.Name || r.name || r.Nom || '';
        const rowOrder = r['Professional Order'] || r['Ordre Professionnel'] || '';
        return rowName.toLowerCase() === name.toLowerCase() && rowOrder.trim() !== '';
      });
    }

    if (matchedRows.length > 0) {
      const latest = matchedRows[matchedRows.length - 1];
      const order = latest['Professional Order'] || latest['Ordre Professionnel'] || '';
      console.log(`Found professional order: "${order}"`);
      return order;
    }
  } catch (err) {
    console.error('Error looking up professional order:', err.message);
  }
  return '';
}

async function downloadPDF(order) {
  const filename = order
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_');

  const key = `manuals/${filename}.pdf`;
  console.log(`Looking for PDF at S3 key: ${key}`);
  console.log(`Using bucket: ${BUCKET}, region: ${AWS_REGION}`);

  try {
    const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    const response = await s3.send(command);
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    console.log(`PDF downloaded successfully: ${key}`);
    return Buffer.concat(chunks);
  } catch (err) {
    console.error(`PDF not found at ${key}:`, err.message);
    console.error('Full error:', err.name, err.Code);
    return null;
  }
}

async function watermarkPDF(pdfBuffer, customerName, order, date) {
  const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pages = pdfDoc.getPages();
  const watermarkText = `Matériel d'étude personnel pour : ${customerName}`;

  for (const page of pages) {
    const { width, height } = page.getSize();
    const positions = [
      { x: width * 0.1, y: height * 0.25 },
      { x: width * 0.1, y: height * 0.5 },
      { x: width * 0.1, y: height * 0.75 },
    ];
    for (const pos of positions) {
      page.drawText(watermarkText, {
        x: pos.x, y: pos.y, size: 11, font,
        color: rgb(0.7, 0.7, 0.7), opacity: 0.35,
        rotate: { type: 'degrees', angle: 35 },
      });
    }
    page.drawText(`Matériel d'étude personnel pour : ${customerName} — Académie LTA — ${date}`, {
      x: 30, y: 20, size: 7, font,
      color: rgb(0.5, 0.5, 0.5), opacity: 0.6,
    });
  }
  return await pdfDoc.save();
}

async function uploadAndGetSignedUrl(pdfBuffer, sessionId, order) {
  const filename = order
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_');

  const key = `watermarked/${sessionId}-${filename}.pdf`;
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key,
    Body: pdfBuffer, ContentType: 'application/pdf',
  }));
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  const url = await getSignedUrl(s3, command, { expiresIn: 172800 });
  console.log(`Pre-signed URL generated for: ${key}`);
  return url;
}

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

    const professionalOrder = await lookupProfessionalOrder(customerEmail, customerName);
    const productLabel = professionalOrder ? `Manuel OQLF — ${professionalOrder}` : 'Manuel OQLF';
    const pdfPassword = generatePassword();

    let downloadUrl = null;
    let pdfAvailable = false;

    if (professionalOrder) {
      const pdfBuffer = await downloadPDF(professionalOrder);
      if (pdfBuffer) {
        console.log('Watermarking PDF...');
        const watermarked = await watermarkPDF(pdfBuffer, customerName, professionalOrder, date);
        downloadUrl = await uploadAndGetSignedUrl(watermarked, sessionId, professionalOrder);
        pdfAvailable = true;
        console.log('PDF delivery complete!');
      }
    }

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
