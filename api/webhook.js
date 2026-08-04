import Stripe from 'stripe';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { GoogleAuth } from 'google-auth-library';
import { google } from 'googleapis';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const PAYGOGPT_FLOW_WEBHOOK = process.env.PAYGOGPT_FLOW_WEBHOOK; // flow 4275 — form submission only
const PAYGOGPT_PDF_WEBHOOK = 'https://app.paygogpt.com/api/webhooks/flow/4276/4a4d2faafff257132ecf4af2b229781f2ec75fabce8b65d7f2a774839cf6e792'; // flow 4276 — PDF delivery after payment
const RENDER_ENCRYPT_URL = 'https://pronunciation-api-l0pg.onrender.com/encrypt-pdf';

// Private Google Sheet — Orders tab
const SHEET_ID = '1Ia4M7Lk2UsrCXwolCwzJ0uA0jAqthxMrYceBbPDtEMQ';
const SHEET_TAB = 'Sheet1';

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

export const config = { api: { bodyParser: false } };

// ─── GOOGLE SHEETS AUTH ───────────────────────────────────────────────────────
async function getSheetsClient() {
  const keyJson = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const auth = new GoogleAuth({
    credentials: keyJson,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const authClient = await auth.getClient();
  return google.sheets({ version: 'v4', auth: authClient });
}

// ─── PRODUCT REGISTRY ─────────────────────────────────────────────────────────
const PRODUCTS = {
  'price_1TiPJGG28GGFb8g3mTOylxoY': { name: 'Manuel Uniquement', label: 'Manuel Uniquement', amountDisplay: 'CA$298.99', includesManuel: true, includesClasses: false, classHours: 0 },
  'price_1Ti0yyG28GGFb8g3kYvzlEMd': { name: 'Forfait Débutant A1-A2', label: 'Forfait Débutant (A1-A2)', amountDisplay: 'CA$1,495', includesManuel: true, includesClasses: true, classHours: 25 },
  'price_1TjY6CG28GGFb8g3n2Y3B81w': { name: 'Forfait Débutant A1-A2', label: 'Forfait Débutant (A1-A2)', amountDisplay: 'CA$1,495', includesManuel: true, includesClasses: true, classHours: 25 },
  'price_1Ti17cG28GGFb8g3wHe0Q4QX': { name: 'Forfait Élémentaire A2-B1', label: 'Forfait Élémentaire (A2-B1)', amountDisplay: 'CA$995', includesManuel: true, includesClasses: true, classHours: 15 },
  'price_1Ti1kSG28GGFb8g3l3GpIeDv': { name: 'Forfait Réussite OQLF B1-B2', label: 'Forfait Réussite OQLF (B1-B2)', amountDisplay: 'CA$795', includesManuel: true, includesClasses: true, classHours: 10 },
  'price_1Ti1lmG28GGFb8g3cLalrUIN': { name: 'Forfait VIP', label: 'Forfait VIP ⭐', amountDisplay: 'CA$1,795', includesManuel: true, includesClasses: true, classHours: 30 },
  'price_1TiOnQG28GGFb8g3jGa0B7cO': { name: 'Cours à la carte', label: 'Cours à la carte', amountDisplay: 'CA$60/heure', includesManuel: false, includesClasses: true, classHours: null },
};

const WEBSHOP_PRODUCTS = {
  'MANUEL-OQLF': { name: 'Manuel OQLF', label: 'Manuel OQLF', amountDisplay: 'CA$298.99', includesManuel: true, includesClasses: false, classHours: 0 },
  'FORFAIT-DEBUTANT': { name: 'Forfait Débutant A1-A2', label: 'Forfait Débutant (A1-A2)', amountDisplay: 'CA$1,495', includesManuel: true, includesClasses: true, classHours: 25 },
  'FORFAIT-ELEMENTAIRE': { name: 'Forfait Élémentaire A2-B1', label: 'Forfait Élémentaire (A2-B1)', amountDisplay: 'CA$995', includesManuel: true, includesClasses: true, classHours: 15 },
  'FORFAIT-REUSSITE': { name: 'Forfait Réussite OQLF B1-B2', label: 'Forfait Réussite OQLF (B1-B2)', amountDisplay: 'CA$795', includesManuel: true, includesClasses: true, classHours: 10 },
  'FORFAIT-VIP': { name: 'Forfait VIP', label: 'Forfait VIP ⭐', amountDisplay: 'CA$1,795', includesManuel: true, includesClasses: true, classHours: 30 },
  'COURS-CARTE': { name: 'Cours à la carte', label: 'Cours à la carte', amountDisplay: 'CA$60/heure', includesManuel: false, includesClasses: true, classHours: null },
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${seg()}-${seg()}-${seg()}`;
}

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ─── SHEET LOOKUP ─────────────────────────────────────────────────────────────
async function lookupFromSheet(email, stripeName) {
  try {
    console.log(`Looking up ordre for: ${email}`);
    const sheets = await getSheetsClient();
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_TAB}!A:G`,
    });
    const rows = resp.data.values || [];
    if (rows.length < 2) {
      console.log('Sheet empty');
      return { formName: stripeName, order: '' };
    }
    const headers = rows[0];
    const emailCol = headers.indexOf('Email');
    const nameCol = headers.indexOf('Name');
    const orderCol = headers.indexOf('Professional Order');

    if (emailCol === -1 || orderCol === -1) {
      console.error('Sheet columns not found:', headers);
      return { formName: stripeName, order: '' };
    }

    const dataRows = rows.slice(1);
    const matched = dataRows.filter(row => {
      const rowEmail = (row[emailCol] || '').toLowerCase().trim();
      const rowOrder = (row[orderCol] || '').trim();
      return rowEmail === email.toLowerCase().trim() && rowOrder !== '';
    });

    if (matched.length === 0 && stripeName) {
      const byName = dataRows.filter(row => {
        const rowName = (row[nameCol] || '').toLowerCase().trim();
        const rowOrder = (row[orderCol] || '').trim();
        return rowName === stripeName.toLowerCase().trim() && rowOrder !== '';
      });
      if (byName.length > 0) {
        const last = byName[byName.length - 1];
        console.log(`Sheet match by name: order="${last[orderCol]}"`);
        return { formName: last[nameCol] || stripeName, order: last[orderCol] || '' };
      }
    }

    if (matched.length > 0) {
      const last = matched[matched.length - 1];
      console.log(`Sheet match by email: order="${last[orderCol]}"`);
      return { formName: last[nameCol] || stripeName, order: last[orderCol] || '' };
    }

    console.log('No sheet match found');
  } catch (err) {
    console.error('Sheet lookup error:', err.message);
  }
  return { formName: stripeName, order: '' };
}

// ─── DEDUPLICATION ────────────────────────────────────────────────────────────
const processedSessions = new Set();

// ─── PDF DELIVERY ─────────────────────────────────────────────────────────────
async function downloadPDF(order) {
  const BUCKET = process.env.S3_BUCKET || 'academielta';
  const filename = order
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s-]/g, '').trim()
    .replace(/\s+/g, '_');
  const key = `manuals/${filename}.pdf`;
  console.log(`Looking for PDF: ${key}`);
  try {
    const resp = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const chunks = [];
    for await (const c of resp.Body) chunks.push(c);
    console.log(`PDF downloaded: ${key}`);
    return { buffer: Buffer.concat(chunks), filename };
  } catch (err) {
    console.error(`PDF not found: ${key}`, err.message);
    return null;
  }
}

async function watermarkPDF(pdfBuffer, formName, stripeName, date) {
  const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pages = pdfDoc.getPages();
  const wmText = (stripeName && stripeName !== formName)
    ? `Matériel d'étude personnel pour : ${formName} (${stripeName})`
    : `Matériel d'étude personnel pour : ${formName}`;
  const ftText = (stripeName && stripeName !== formName)
    ? `© Académie LTA — ${formName} (${stripeName}) — ${date} — Usage personnel uniquement`
    : `© Académie LTA — ${formName} — ${date} — Usage personnel uniquement`;
  for (const page of pages) {
    const { width, height } = page.getSize();
    page.drawText(wmText, { x: width * 0.08, y: height * 0.45, size: 11, font, color: rgb(0.7, 0.7, 0.7), opacity: 0.20, rotate: { type: 'degrees', angle: 35 } });
    page.drawText(ftText, { x: 30, y: 15, size: 7, font, color: rgb(0.5, 0.5, 0.5), opacity: 0.6 });
  }
  return await pdfDoc.save({ useObjectStreams: false, addDefaultPage: false });
}

async function encryptViaRender(pdfBuffer, password) {
  console.log('Sending to Render for encryption...');
  const pdfBase64 = pdfBuffer.toString('base64');
  const resp = await fetch(RENDER_ENCRYPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pdf_base64: pdfBase64, password }),
  });
  if (!resp.ok) throw new Error(`Render encrypt failed: ${resp.status} ${await resp.text()}`);
  const encrypted = Buffer.from(await resp.arrayBuffer());
  console.log('PDF encrypted!');
  return encrypted;
}

async function uploadAndGetSignedUrl(pdfBuffer, filename) {
  const BUCKET = process.env.S3_BUCKET || 'academielta';
  const key = `watermarked/${filename}-${Date.now()}.pdf`;
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: pdfBuffer, ContentType: 'application/pdf' }));
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 172800 });
  console.log(`Signed URL generated: ${key}`);
  return url;
}

// ─── RESOLVE PRODUCT ──────────────────────────────────────────────────────────
function resolveProduct(item) {
  const priceId = item.price?.id || '';
  if (PRODUCTS[priceId]) { console.log(`Matched by price ID: ${priceId}`); return PRODUCTS[priceId]; }
  const sku = item.price?.metadata?.sku || item.price?.product?.metadata?.sku || '';
  if (sku && WEBSHOP_PRODUCTS[sku]) { console.log(`Matched by SKU: ${sku}`); return WEBSHOP_PRODUCTS[sku]; }
  const productName = item.description || item.price?.product?.name || '';
  for (const [, product] of Object.entries(WEBSHOP_PRODUCTS)) {
    if (productName.toLowerCase().includes(product.name.toLowerCase())) {
      console.log(`Matched by name: ${productName}`);
      return product;
    }
  }
  console.log(`No product match — priceId: ${priceId}, sku: ${sku}, name: ${productName}`);
  return null;
}

// ─── PROCESS LINE ITEM ────────────────────────────────────────────────────────
async function processLineItem(product, item, formName, stripeName, professionalOrder, date) {
  const quantity = item.quantity || 1;
  const unitAmount = item.price?.unit_amount || 0;
  const itemTotal = item.amount_total || (unitAmount * quantity);
  const amountDisplay = quantity > 1
    ? `CA$${(itemTotal / 100).toFixed(2)} (${quantity} × CA$${(unitAmount / 100).toFixed(2)})`
    : product.amountDisplay;
  console.log(`Processing: ${product.name} × ${quantity}`);
  let downloadUrl = null;
  let pdfAvailable = false;
  const pdfPassword = generatePassword();
  if (product.includesManuel && professionalOrder) {
    const pdfResult = await downloadPDF(professionalOrder);
    if (pdfResult) {
      const watermarked = await watermarkPDF(pdfResult.buffer, formName, stripeName, date);
      try {
        const encrypted = await encryptViaRender(Buffer.from(watermarked), pdfPassword);
        downloadUrl = await uploadAndGetSignedUrl(encrypted, pdfResult.filename);
        pdfAvailable = true;
      } catch (encErr) {
        console.error('Encryption failed, watermark only:', encErr.message);
        downloadUrl = await uploadAndGetSignedUrl(Buffer.from(watermarked), pdfResult.filename);
        pdfAvailable = true;
      }
    }
  }
  return { downloadUrl, pdfPassword, pdfAvailable, amountDisplay, quantity };
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Signature failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const customerEmail = session.customer_email || session.customer_details?.email || '';
    const stripeName = session.customer_details?.name || '';
    const sessionId = session.id;
    const currency = session.currency?.toUpperCase() || 'CAD';
    const sessionTotal = session.amount_total || 0;
    const date = new Date().toLocaleDateString('fr-CA');

    console.log(`Payment: ${customerEmail} | ${sessionId} | CA$${(sessionTotal / 100).toFixed(2)}`);

    if (processedSessions.has(sessionId)) {
      console.log('Already processed, skipping.');
      return res.status(200).json({ received: true, skipped: true });
    }
    processedSessions.add(sessionId);

    // Look up ordre from private Google Sheet
    const { formName, order: professionalOrder } = await lookupFromSheet(customerEmail, stripeName);
    console.log(`Name: "${formName}", Ordre: "${professionalOrder}"`);

    // Get line items
    let lineItems = [];
    try {
      const result = await stripe.checkout.sessions.listLineItems(sessionId, {
        limit: 10,
        expand: ['data.price', 'data.price.product'],
      });
      lineItems = result.data;
    } catch (err) {
      console.error('Line items error:', err.message);
    }

    const recognizedItems = lineItems
      .map(item => ({ item, product: resolveProduct(item) }))
      .filter(({ product }) => !!product);

    if (recognizedItems.length === 0) {
      console.log('No recognized products — skipping.');
      return res.status(200).json({ received: true, skipped: true });
    }

    const productNames = recognizedItems
      .map(({ product, item }) => item.quantity > 1 ? `${product.label} ×${item.quantity}` : product.label)
      .join(' + ');

    const results = [];
    for (const { item, product } of recognizedItems) {
      const result = await processLineItem(product, item, formName, stripeName, professionalOrder, date);
      results.push({ product, item, ...result });
    }

    const pdfItems = results.filter(r => r.pdfAvailable);
    const classItems = results.filter(r => r.product.includesClasses);
    const totalClassHours = classItems.reduce((sum, r) => {
      if (r.product.classHours !== null) {
        return sum + (r.product.classHours * (r.item.quantity || 1));
      }
      // Cours à la carte — use Stripe quantity as hours
      return sum + (r.item.quantity || 1);
    }, 0);
    const totalQuantity = recognizedItems.reduce((sum, { item }) => sum + (item.quantity || 1), 0);
    const primaryPdf = pdfItems[0];

    // Determine which flow to fire based on product type
    const FLOW_CLASSES_ONLY = 'https://app.paygogpt.com/api/webhooks/flow/4721/0cc996c684f8d785bd582f79a8fe096dc033d7d4d2a5667ad44baa27db6c0ff6';
    const FLOW_PACKAGE = 'https://app.paygogpt.com/api/webhooks/flow/4722/222aca1740711dad87721e1c201bd87c1fc1ef291e8f48ebfc9c75e8c07d67c9';
    let targetWebhook = PAYGOGPT_PDF_WEBHOOK;
    if (pdfItems.length > 0 && classItems.length > 0) {
      targetWebhook = FLOW_PACKAGE;
    } else if (pdfItems.length === 0 && classItems.length > 0) {
      targetWebhook = FLOW_CLASSES_ONLY;
    }

    // Fire appropriate flow after confirmed payment
    try {
      const resp = await fetch(targetWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactEmail: customerEmail,
          contactName: formName,
          widgetId: 97667780,
          data: {
            product_name: productNames,
            professional_order: professionalOrder,
            stripe_name: stripeName,
            amount_display: `CA$${(sessionTotal / 100).toFixed(2)}`,
            stripe_session_id: sessionId,
            currency,
            current_date: date,
            download_url: primaryPdf?.downloadUrl || '',
            pdf_password: primaryPdf?.pdfPassword || '',
            pdf_available: pdfItems.length > 0 ? 'yes' : 'no',
            includes_classes: classItems.length > 0 ? 'yes' : 'no',
            class_hours: totalClassHours > 0 ? String(totalClassHours) : '',
            includes_manuel: pdfItems.length > 0 ? 'yes' : 'no',
            quantity: String(totalQuantity),
          },
        }),
      });
      if (!resp.ok) console.error('PDF flow trigger failed:', await resp.text());
      else console.log('Flow 4276 triggered successfully — PDF delivery email sent');
    } catch (err) {
      console.error('Flow 4276 error:', err.message);
    }
  }

  res.status(200).json({ received: true });
}
