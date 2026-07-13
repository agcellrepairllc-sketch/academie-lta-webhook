import Stripe from 'stripe';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const PAYGOGPT_FLOW_WEBHOOK = process.env.PAYGOGPT_FLOW_WEBHOOK;
const RENDER_ENCRYPT_URL = 'https://pronunciation-api-l0pg.onrender.com/encrypt-pdf';

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

export const config = { api: { bodyParser: false } };

// ─── PRODUCT REGISTRY ─────────────────────────────────────────────────────────
// Add new Stripe price IDs here — webhook handles them automatically
// OLD price IDs (kept for backwards compatibility with direct Stripe payment links)
const PRODUCTS = {
  // ── OLD ACCOUNT — direct Stripe payment links ──
  'price_1TiPJGG28GGFb8g3mTOylxoY': {
    name: 'Manuel Uniquement',
    label: 'Manuel Uniquement',
    amountDisplay: 'CA$298.99',
    includesManuel: true,
    includesClasses: false,
    classHours: 0,
  },
  'price_1Ti0yyG28GGFb8g3kYvzlEMd': {
    name: 'Forfait Débutant A1-A2',
    label: 'Forfait Débutant (A1-A2)',
    amountDisplay: 'CA$1,495',
    includesManuel: true,
    includesClasses: true,
    classHours: 25,
  },
  'price_1TjY6CG28GGFb8g3n2Y3B81w': {
    name: 'Forfait Débutant A1-A2',
    label: 'Forfait Débutant (A1-A2)',
    amountDisplay: 'CA$1,495',
    includesManuel: true,
    includesClasses: true,
    classHours: 25,
  },
  'price_1Ti17cG28GGFb8g3wHe0Q4QX': {
    name: 'Forfait Élémentaire A2-B1',
    label: 'Forfait Élémentaire (A2-B1)',
    amountDisplay: 'CA$995',
    includesManuel: true,
    includesClasses: true,
    classHours: 15,
  },
  'price_1Ti1kSG28GGFb8g3l3GpIeDv': {
    name: 'Forfait Réussite OQLF B1-B2',
    label: 'Forfait Réussite OQLF (B1-B2)',
    amountDisplay: 'CA$795',
    includesManuel: true,
    includesClasses: true,
    classHours: 10,
  },
  'price_1Ti1lmG28GGFb8g3cLalrUIN': {
    name: 'Forfait VIP',
    label: 'Forfait VIP ⭐',
    amountDisplay: 'CA$1,795',
    includesManuel: true,
    includesClasses: true,
    classHours: 30,
  },
  'price_1TiOnQG28GGFb8g3jGa0B7cO': {
    name: 'Cours à la carte',
    label: 'Cours à la carte',
    amountDisplay: 'CA$60/heure',
    includesManuel: false,
    includesClasses: true,
    classHours: null,
  },
  // ── NEW WEBSHOP — PaygoGPT native Stripe checkout ──
  // Add new price IDs here as they are created in Stripe via PaygoGPT webshop
  // Format: 'price_XXXXX': { name, label, amountDisplay, includesManuel, includesClasses, classHours }
};

// ─── WEBSHOP PRODUCT MAP ───────────────────────────────────────────────────────
// Maps webshop product SKUs to product config (for PaygoGPT native checkout)
const WEBSHOP_PRODUCTS = {
  'MANUEL-OQLF': {
    name: 'Manuel OQLF',
    label: 'Manuel OQLF',
    amountDisplay: 'CA$298.99',
    includesManuel: true,
    includesClasses: false,
    classHours: 0,
  },
  'FORFAIT-DEBUTANT': {
    name: 'Forfait Débutant A1-A2',
    label: 'Forfait Débutant (A1-A2)',
    amountDisplay: 'CA$1,495',
    includesManuel: true,
    includesClasses: true,
    classHours: 25,
  },
  'FORFAIT-ELEMENTAIRE': {
    name: 'Forfait Élémentaire A2-B1',
    label: 'Forfait Élémentaire (A2-B1)',
    amountDisplay: 'CA$995',
    includesManuel: true,
    includesClasses: true,
    classHours: 15,
  },
  'FORFAIT-REUSSITE': {
    name: 'Forfait Réussite OQLF B1-B2',
    label: 'Forfait Réussite OQLF (B1-B2)',
    amountDisplay: 'CA$795',
    includesManuel: true,
    includesClasses: true,
    classHours: 10,
  },
  'FORFAIT-VIP': {
    name: 'Forfait VIP',
    label: 'Forfait VIP ⭐',
    amountDisplay: 'CA$1,795',
    includesManuel: true,
    includesClasses: true,
    classHours: 30,
  },
  'COURS-CARTE': {
    name: 'Cours à la carte',
    label: 'Cours à la carte',
    amountDisplay: 'CA$60/heure',
    includesManuel: false,
    includesClasses: true,
    classHours: null,
  },
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

// ─── ORDRE PROFESSIONNEL RESOLUTION ───────────────────────────────────────────
// Priority: 1) Stripe metadata, 2) Line item description, 3) Empty string
async function resolveOrdre(session, lineItems) {
  // 1. Check Stripe session metadata (set by PaygoGPT webshop variant)
  const metaOrdre = session.metadata?.ordre_professionnel
    || session.metadata?.variant
    || session.metadata?.professional_order
    || '';
  if (metaOrdre.trim()) {
    console.log(`Ordre from metadata: "${metaOrdre}"`);
    return metaOrdre.trim();
  }

  // 2. Check line item description for variant info
  for (const item of lineItems) {
    const desc = item.description || item.price?.product?.description || '';
    // PaygoGPT webshop puts variant in description as "Product Name - Variant"
    const variantMatch = desc.match(/[-–]\s*(.+)$/);
    if (variantMatch && variantMatch[1].trim()) {
      const variant = variantMatch[1].trim();
      // Only use if it looks like an ordre (not a price or level description)
      if (!variant.match(/^\d/) && !variant.match(/^(A1|A2|B1|B2)/i)) {
        console.log(`Ordre from line item description: "${variant}"`);
        return variant;
      }
    }
  }

  // 3. Check Stripe payment_intent metadata
  try {
    if (session.payment_intent) {
      const pi = await stripe.paymentIntents.retrieve(session.payment_intent);
      const piOrdre = pi.metadata?.ordre_professionnel
        || pi.metadata?.variant
        || pi.metadata?.professional_order
        || '';
      if (piOrdre.trim()) {
        console.log(`Ordre from payment_intent metadata: "${piOrdre}"`);
        return piOrdre.trim();
      }
    }
  } catch (err) {
    console.error('PaymentIntent lookup error:', err.message);
  }

  console.log('No ordre found in metadata or line items');
  return '';
}

// ─── DEDUPLICATION ────────────────────────────────────────────────────────────
const processedSessions = new Set(); // in-memory dedup for same-instance requests

async function isAlreadyProcessed(sessionId) {
  // In-memory check first (fast)
  if (processedSessions.has(sessionId)) return true;
  // Could add S3/sheet check here if needed
  return false;
}

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
  if (!resp.ok) {
    const e = await resp.text();
    throw new Error(`Render encrypt failed: ${resp.status} ${e}`);
  }
  const encrypted = Buffer.from(await resp.arrayBuffer());
  console.log('PDF encrypted via Render!');
  return encrypted;
}

async function uploadAndGetSignedUrl(pdfBuffer, filename) {
  const BUCKET = process.env.S3_BUCKET || 'academielta';
  const key = `watermarked/${filename}-${Date.now()}.pdf`;
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: pdfBuffer, ContentType: 'application/pdf' }));
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 172800 });
  console.log(`URL generated: ${key}`);
  return url;
}

// ─── PROCESS ONE LINE ITEM ────────────────────────────────────────────────────
async function processLineItem(product, item, formName, stripeName, professionalOrder, date) {
  const quantity = item.quantity || 1;
  const unitAmount = item.price?.unit_amount || 0;
  const itemTotal = item.amount_total || (unitAmount * quantity);
  const amountDisplay = quantity > 1
    ? `CA$${(itemTotal / 100).toFixed(2)} (${quantity} × CA$${(unitAmount / 100).toFixed(2)})`
    : product.amountDisplay;

  console.log(`Processing: ${product.name} × ${quantity} = ${amountDisplay}`);

  let downloadUrl = null;
  let pdfAvailable = false;
  const pdfPassword = generatePassword();

  if (product.includesManuel && professionalOrder) {
    const pdfResult = await downloadPDF(professionalOrder);
    if (pdfResult) {
      console.log('Watermarking...');
      const watermarked = await watermarkPDF(pdfResult.buffer, formName, stripeName, date);
      try {
        const encrypted = await encryptViaRender(Buffer.from(watermarked), pdfPassword);
        downloadUrl = await uploadAndGetSignedUrl(encrypted, pdfResult.filename);
        pdfAvailable = true;
        console.log('PDF delivery complete with encryption!');
      } catch (encErr) {
        console.error('Encryption failed, watermark only:', encErr.message);
        downloadUrl = await uploadAndGetSignedUrl(Buffer.from(watermarked), pdfResult.filename);
        pdfAvailable = true;
      }
    }
  }

  return { downloadUrl, pdfPassword, pdfAvailable, amountDisplay, quantity };
}

// ─── RESOLVE PRODUCT FROM LINE ITEM ───────────────────────────────────────────
function resolveProduct(item) {
  // 1. Try direct Stripe price ID match (old system + new Stripe prices)
  const priceId = item.price?.id || '';
  if (PRODUCTS[priceId]) {
    console.log(`Product matched by price ID: ${priceId}`);
    return PRODUCTS[priceId];
  }

  // 2. Try webshop SKU match (PaygoGPT webshop sets SKU in price metadata)
  const sku = item.price?.metadata?.sku
    || item.price?.product?.metadata?.sku
    || '';
  if (sku && WEBSHOP_PRODUCTS[sku]) {
    console.log(`Product matched by SKU: ${sku}`);
    return WEBSHOP_PRODUCTS[sku];
  }

  // 3. Try product name match (fallback)
  const productName = item.description || item.price?.product?.name || '';
  for (const [, product] of Object.entries(WEBSHOP_PRODUCTS)) {
    if (productName.toLowerCase().includes(product.name.toLowerCase())) {
      console.log(`Product matched by name: ${productName}`);
      return product;
    }
  }

  console.log(`No product match for price ID: ${priceId}, SKU: ${sku}, name: ${productName}`);
  return null;
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

    console.log(`Payment confirmed: ${customerEmail} | Session: ${sessionId} | Total: CA$${(sessionTotal / 100).toFixed(2)}`);

    // Deduplication
    if (await isAlreadyProcessed(sessionId)) {
      console.log('Already processed, skipping.');
      return res.status(200).json({ received: true, skipped: true });
    }
    processedSessions.add(sessionId);

    // Get ALL line items
    let lineItems = [];
    try {
      const result = await stripe.checkout.sessions.listLineItems(sessionId, {
        limit: 10,
        expand: ['data.price', 'data.price.product'],
      });
      lineItems = result.data;
      console.log(`Line items found: ${lineItems.length}`);
    } catch (err) {
      console.error('Could not get line items:', err.message);
    }

    // Resolve ordre professionnel — metadata first, then line item description
    const professionalOrder = await resolveOrdre(session, lineItems);
    const formName = session.customer_details?.name || stripeName || '';

    console.log(`Customer: "${formName}", Ordre: "${professionalOrder}"`);

    // Match line items to known products
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

    console.log(`Products: ${productNames}`);

    // Process each item
    const results = [];
    for (const { item, product } of recognizedItems) {
      const result = await processLineItem(product, item, formName, stripeName, professionalOrder, date);
      results.push({ product, item, ...result });
    }

    // Aggregate delivery data
    const pdfItems = results.filter(r => r.pdfAvailable);
    const classItems = results.filter(r => r.product.includesClasses);
    const totalClassHours = classItems.reduce((sum, r) => {
      return sum + (r.product.classHours ? r.product.classHours * (r.item.quantity || 1) : 0);
    }, 0);
    const totalQuantity = recognizedItems.reduce((sum, { item }) => sum + (item.quantity || 1), 0);

    const allDownloadUrls = pdfItems.map(r => r.downloadUrl).join('\n');
    const allPasswords = pdfItems.map(r => `${r.product.label}: ${r.pdfPassword}`).join('\n');
    const primaryPdf = pdfItems[0];

    // Trigger PaygoGPT flow webhook
    try {
      const resp = await fetch(PAYGOGPT_FLOW_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactEmail: customerEmail,
          contactName: formName,
          data: {
            product_name: productNames,
            product_label: productNames,
            professional_order: professionalOrder,
            stripe_name: stripeName,
            amount_cents: sessionTotal,
            amount_display: `CA$${(sessionTotal / 100).toFixed(2)}`,
            stripe_session_id: sessionId,
            currency,
            // Primary PDF
            download_url: primaryPdf?.downloadUrl || '',
            pdf_password: primaryPdf?.pdfPassword || '',
            pdf_available: pdfItems.length > 0 ? 'yes' : 'no',
            // All PDFs (upsell support)
            all_download_urls: allDownloadUrls,
            all_pdf_passwords: allPasswords,
            pdf_count: String(pdfItems.length),
            // Classes
            includes_classes: classItems.length > 0 ? 'yes' : 'no',
            class_hours: totalClassHours > 0 ? String(totalClassHours) : '',
            includes_manuel: pdfItems.length > 0 ? 'yes' : 'no',
            // Quantity
            quantity: String(totalQuantity),
          },
        }),
      });
      if (!resp.ok) console.error('Flow trigger failed:', await resp.text());
      else console.log('Flow triggered successfully');
    } catch (err) {
      console.error('Flow error:', err.message);
    }
  }

  res.status(200).json({ received: true });
}
