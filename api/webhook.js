import Stripe from 'stripe';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const PAYGOGPT_FLOW_WEBHOOK = process.env.PAYGOGPT_FLOW_WEBHOOK;
const GOOGLE_SHEET_API = 'https://app.paygogpt.com/api/public/landing-pages/4156/sheet-data';
const PDF_CO_API_KEY = process.env.PDF_CO_API_KEY;

const AWS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || '';
const AWS_SECRET = process.env.AWS_SECRET_ACCESS_KEY || '';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const BUCKET = process.env.S3_BUCKET || 'academielta';

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
    return null;
  }
}

async function watermarkPDF(pdfBuffer, customerName, date) {
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
    page.drawText(`Matériel d'étude personnel pour : ${customerName} — Académie LTA — ${date} — © Usage personnel uniquement`, {
      x: 30, y: 20, size: 7, font,
      color: rgb(0.5, 0.5, 0.5), opacity: 0.6,
    });
  }
  return await pdfDoc.save();
}

async function encryptPDFWithPdfCo(pdfBuffer, password, sessionId) {
  console.log('Uploading PDF to PDF.co for encryption...');

  // Step 1: Get presigned upload URL from PDF.co
  const uploadRes = await fetch('https://api.pdf.co/v1/file/upload/get-presigned-url?contenttype=application/pdf&name=manual.pdf', {
    headers: { 'x-api-key': PDF_CO_API_KEY },
  });
  const uploadData = await uploadRes.json();

  if (!uploadData.presignedUrl) {
    throw new Error('Failed to get PDF.co upload URL: ' + JSON.stringify(uploadData));
  }

  // Step 2: Upload PDF to PDF.co
  await fetch(uploadData.presignedUrl, {
    method: 'PUT',
    headers: { 'content-type': 'application/pdf' },
    body: pdfBuffer,
  });

  console.log('PDF uploaded to PDF.co, encrypting...');

  // Step 3: Encrypt the PDF
  const encryptRes = await fetch('https://api.pdf.co/v1/pdf/security/add', {
    method: 'POST',
    headers: {
      'x-api-key': PDF_CO_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: uploadData.url,
      userPassword: password,
      ownerPassword: password + '-OWNER',
      allowPrinting: false,
      allowCopyContent: false,
      allowModifyDocument: false,
      async: false,
      name: `${sessionId}-encrypted.pdf`,
    }),
  });

  const encryptData = await encryptRes.json();

  if (encryptData.error || !encryptData.url) {
    throw new Error('PDF.co encryption failed: ' + JSON.stringify(encryptData));
  }

  console.log('PDF encrypted successfully by PDF.co');

  // Step 4: Download encrypted PDF
  const downloadRes = await fetch(encryptData.url);
  const encryptedBuffer = Buffer.from(await downloadRes.arrayBuffer());

  return encryptedBuffer;
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
        const watermarked = await watermarkPDF(pdfBuffer, customerName, date);

        console.log('Encrypting PDF with password...');
        try {
          const encrypted = await encryptPDFWithPdfCo(watermarked, pdfPassword, sessionId);
          downloadUrl = await uploadAndGetSignedUrl(encrypted, sessionId, professionalOrder);
          pdfAvailable = true;
          console.log('PDF delivery complete with encryption!');
        } catch (encErr) {
          console.error('Encryption failed, uploading without encryption:', encErr.message);
          // Fallback: upload without encryption
          downloadUrl = await uploadAndGetSignedUrl(watermarked, sessionId, professionalOrder);
          pdfAvailable = true;
          console.log('PDF delivery complete (no encryption)');
        }
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
// Generate pronunciation trial token
try {
  await fetch('https://academie-lta-webhook.vercel.app/api/create-token', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
    },
    body: JSON.stringify({
      email:              customerEmail,
      name:               customerName,
      professional_order: professionalOrder,
      token_type:         'trial',
      stripe_session_id:  sessionId
    })
  });
  console.log('Pronunciation trial token created');
} catch (err) {
  console.error('Trial token creation failed:', err.message);
}
      }
    } catch (err) {
      console.error('Error triggering PaygoGPT flow:', err.message);
    }
  }

  res.status(200).json({ received: true });
}
