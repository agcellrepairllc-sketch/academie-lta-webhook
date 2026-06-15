import Stripe from 'stripe';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const PAYGOGPT_FLOW_WEBHOOK = process.env.PAYGOGPT_FLOW_WEBHOOK;
const GOOGLE_SHEET_API = 'https://app.paygogpt.com/api/public/landing-pages/4156/sheet-data';
const RENDER_ENCRYPT_URL = 'https://pronunciation-api-l0pg.onrender.com/encrypt-pdf';

const AWS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || '';
const AWS_SECRET = process.env.AWS_SECRET_ACCESS_KEY || '';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const BUCKET = process.env.S3_BUCKET || 'academielta';

const s3 = new S3Client({
  region: AWS_REGION,
  credentials: { accessKeyId: AWS_KEY_ID, secretAccessKey: AWS_SECRET },
});

export const config = { api: { bodyParser: false } };

// ─── PRODUCT REGISTRY ───────────────────────────────────────────────────────
const PRODUCTS = {
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
    classHours: null, // variable
  },
};

// ─── HELPERS ────────────────────────────────────────────────────────────────
function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = () => Array.from({length:4},()=>chars[Math.floor(Math.random()*chars.length)]).join('');
  return `${seg()}-${seg()}-${seg()}`;
}

async function getRawBody(req) {
  return new Promise((resolve,reject)=>{
    const chunks=[];
    req.on('data',(c)=>chunks.push(c));
    req.on('end',()=>resolve(Buffer.concat(chunks)));
    req.on('error',reject);
  });
}

async function isAlreadyProcessed(sessionId) {
  try {
    const res = await fetch(GOOGLE_SHEET_API);
    const data = await res.json();
    const rows = data.rows || data.data || [];
    const found = rows.some(r=>(r['Payment ID']||'')===sessionId);
    if(found) console.log(`Already processed: ${sessionId}`);
    return found;
  } catch(err){console.error('Duplicate check error:',err.message);return false;}
}

async function lookupFromSheet(email, stripeName) {
  try {
    const res = await fetch(GOOGLE_SHEET_API);
    const data = await res.json();
    const rows = data.rows || data.data || [];
    let matched = rows.filter(r=>{
      const e=r.Email||r.email||'';
      const o=r['Professional Order']||r['Ordre Professionnel']||'';
      return e.toLowerCase()===email.toLowerCase() && o.trim()!=='';
    });
    if(matched.length===0 && stripeName){
      matched = rows.filter(r=>{
        const n=r.Name||r.name||r.Nom||'';
        const o=r['Professional Order']||r['Ordre Professionnel']||'';
        return n.toLowerCase()===stripeName.toLowerCase() && o.trim()!=='';
      });
    }
    if(matched.length>0){
      const l=matched[matched.length-1];
      const order=l['Professional Order']||l['Ordre Professionnel']||'';
      const formName=l['Name']||l['Nom']||stripeName||'';
      console.log(`Found — Form: "${formName}", Order: "${order}"`);
      return {formName,order};
    }
  } catch(err){console.error('Sheet lookup error:',err.message);}
  return {formName:stripeName,order:''};
}

async function downloadPDF(order) {
  const filename = order.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9\s-]/g,'').trim().replace(/\s+/g,'_');
  const key = `manuals/${filename}.pdf`;
  console.log(`Looking for PDF: ${key}`);
  try {
    const resp = await s3.send(new GetObjectCommand({Bucket:BUCKET,Key:key}));
    const chunks=[];
    for await(const c of resp.Body) chunks.push(c);
    console.log(`PDF downloaded: ${key}`);
    return {buffer:Buffer.concat(chunks),filename};
  } catch(err){console.error(`PDF not found: ${key}`,err.message);return null;}
}

async function watermarkPDF(pdfBuffer, formName, stripeName, date) {
  const pdfDoc = await PDFDocument.load(pdfBuffer,{ignoreEncryption:true});
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pages = pdfDoc.getPages();
  const wmText = (stripeName && stripeName!==formName)
    ? `Matériel d'étude personnel pour : ${formName} (${stripeName})`
    : `Matériel d'étude personnel pour : ${formName}`;
  const ftText = (stripeName && stripeName!==formName)
    ? `© Académie LTA — ${formName} (${stripeName}) — ${date} — Usage personnel uniquement`
    : `© Académie LTA — ${formName} — ${date} — Usage personnel uniquement`;
  for(const page of pages){
    const {width,height}=page.getSize();
    page.drawText(wmText,{x:width*0.08,y:height*0.45,size:11,font,color:rgb(0.7,0.7,0.7),opacity:0.20,rotate:{type:'degrees',angle:35}});
    page.drawText(ftText,{x:30,y:15,size:7,font,color:rgb(0.5,0.5,0.5),opacity:0.6});
  }
  return await pdfDoc.save({useObjectStreams:false,addDefaultPage:false});
}

async function encryptViaRender(pdfBuffer, password) {
  console.log('Sending to Render for encryption...');
  let pdfBase64 = pdfBuffer.toString('base64');
  while(pdfBase64.length%4!==0) pdfBase64+='=';
  const resp = await fetch(RENDER_ENCRYPT_URL,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({pdf_base64:pdfBase64,password}),
  });
  if(!resp.ok){const e=await resp.text();throw new Error(`Render encrypt failed: ${resp.status} ${e}`);}
  const encrypted = Buffer.from(await resp.arrayBuffer());
  console.log('PDF encrypted via Render!');
  return encrypted;
}

async function uploadAndGetSignedUrl(pdfBuffer, filename) {
  const key = `watermarked/${filename}-${Date.now()}.pdf`;
  await s3.send(new PutObjectCommand({Bucket:BUCKET,Key:key,Body:pdfBuffer,ContentType:'application/pdf'}));
  const url = await getSignedUrl(s3,new GetObjectCommand({Bucket:BUCKET,Key:key}),{expiresIn:172800});
  console.log(`URL generated: ${key}`);
  return url;
}

// ─── MAIN HANDLER ───────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody,sig,process.env.STRIPE_WEBHOOK_SECRET);
  } catch(err){
    console.error('Signature failed:',err.message);
    return res.status(400).json({error:`Webhook Error: ${err.message}`});
  }

  if(event.type==='checkout.session.completed'){
    const session = event.data.object;
    const customerEmail = session.customer_email||session.customer_details?.email||'';
    const stripeName = session.customer_details?.name||'';
    const amountCents = session.amount_total||0;
    const sessionId = session.id;
    const currency = session.currency?.toUpperCase()||'CAD';
    const date = new Date().toLocaleDateString('fr-CA');

    // Identify product from line items
    let priceId = '';
    try {
      const lineItems = await stripe.checkout.sessions.listLineItems(sessionId,{limit:1});
      priceId = lineItems.data[0]?.price?.id || '';
    } catch(err){console.error('Could not get line items:',err.message);}

    const product = PRODUCTS[priceId] || {
      name: 'Académie LTA',
      label: 'Commande',
      amountDisplay: `CA$${(amountCents/100).toFixed(2)}`,
      includesManuel: true,
      includesClasses: false,
      classHours: 0,
    };

    console.log(`Payment confirmed: ${customerEmail} | Product: ${product.name} | Session: ${sessionId}`);

    if(await isAlreadyProcessed(sessionId)){
      return res.status(200).json({received:true,skipped:true});
    }

    const {formName,order:professionalOrder} = await lookupFromSheet(customerEmail,stripeName);
    const pdfPassword = generatePassword();

    console.log(`Form: "${formName}", Stripe: "${stripeName}", Order: "${professionalOrder}", Product: "${product.name}"`);

    // PDF delivery (only for products that include the manual)
    let downloadUrl=null, pdfAvailable=false;

    if(product.includesManuel && professionalOrder){
      const pdfResult = await downloadPDF(professionalOrder);
      if(pdfResult){
        console.log('Watermarking PDF...');
        const watermarked = await watermarkPDF(pdfResult.buffer,formName,stripeName,date);
        try {
          const encrypted = await encryptViaRender(Buffer.from(watermarked),pdfPassword);
          downloadUrl = await uploadAndGetSignedUrl(encrypted,pdfResult.filename);
          pdfAvailable = true;
          console.log('PDF delivery complete with encryption!');
        } catch(encErr){
          console.error('Encryption failed, watermark only:',encErr.message);
          downloadUrl = await uploadAndGetSignedUrl(Buffer.from(watermarked),pdfResult.filename);
          pdfAvailable = true;
        }
      }
    }

    // Trigger PaygoGPT flow
    try {
      const resp = await fetch(PAYGOGPT_FLOW_WEBHOOK,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          contactEmail:customerEmail,
          contactName:formName,
          data:{
            product_name:product.name,
            product_label:product.label,
            professional_order:professionalOrder,
            stripe_name:stripeName,
            amount_cents:amountCents,
            amount_display:product.amountDisplay,
            stripe_session_id:sessionId,
            currency,
            download_url:downloadUrl||'',
            pdf_password:pdfPassword,
            pdf_available:pdfAvailable?'yes':'no',
            includes_manuel:product.includesManuel?'yes':'no',
            includes_classes:product.includesClasses?'yes':'no',
            class_hours:product.classHours||'',
          },
        }),
      });
      if(!resp.ok) console.error('Flow trigger failed:',await resp.text());
      else console.log('Flow triggered successfully');
    } catch(err){console.error('Flow error:',err.message);}
  }

  res.status(200).json({received:true});
}
