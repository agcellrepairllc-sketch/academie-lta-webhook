import Stripe from 'stripe';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { createHash, randomBytes } from 'crypto';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const PAYGOGPT_FLOW_WEBHOOK = process.env.PAYGOGPT_FLOW_WEBHOOK;
const GOOGLE_SHEET_API = 'https://app.paygogpt.com/api/public/landing-pages/4156/sheet-data';

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

// PDF encryption constants
const PADDING = Buffer.from([
  0x28,0xBF,0x4E,0x5E,0x4E,0x75,0x8A,0x41,
  0x64,0x00,0x4E,0x56,0xFF,0xFA,0x01,0x08,
  0x2E,0x2E,0x00,0xB6,0xD0,0x68,0x3E,0x80,
  0x2F,0x0C,0xA9,0xFE,0x64,0x53,0x69,0x7A
]);

function rc4(key, data) {
  const S = Array.from({length:256},(_,i)=>i);
  let j=0;
  for(let i=0;i<256;i++){j=(j+S[i]+key[i%key.length])&0xff;[S[i],S[j]]=[S[j],S[i]];}
  let i=0;j=0;
  const r=Buffer.alloc(data.length);
  for(let k=0;k<data.length;k++){i=(i+1)&0xff;j=(j+S[i])&0xff;[S[i],S[j]]=[S[j],S[i]];r[k]=data[k]^S[(S[i]+S[j])&0xff];}
  return r;
}

function padPwd(pwd){
  const b=Buffer.from(pwd||'','latin1');
  return Buffer.concat([b,PADDING]).slice(0,32);
}

function encryptPDFBuffer(pdfBuffer, userPwd, ownerPwd) {
  const KL = 16; // 128-bit key
  const fileId = randomBytes(16);
  const fileIdHex = fileId.toString('hex').toUpperCase();
  const permissions = -3904; // restrict copy + print

  // Compute owner key
  let oHash = createHash('md5').update(padPwd(ownerPwd)).digest();
  for(let i=0;i<50;i++) oHash=createHash('md5').update(oHash.slice(0,KL)).digest();
  const oKey = oHash.slice(0,KL);
  let oVal = padPwd(userPwd);
  for(let i=0;i<20;i++){const k=Buffer.from(oKey.map((b,x)=>b^i));oVal=rc4(k,oVal);}

  // Compute encryption key
  const permBuf=Buffer.alloc(4); permBuf.writeInt32LE(permissions);
  let eKey=createHash('md5').update(padPwd(userPwd)).update(oVal).update(permBuf).update(fileId).digest().slice(0,KL);
  for(let i=0;i<50;i++) eKey=createHash('md5').update(eKey).digest().slice(0,KL);

  // Compute user value
  let uVal=PADDING;
  for(let i=0;i<20;i++){const k=Buffer.from(eKey.map((b,x)=>b^i));uVal=rc4(k,uVal);}
  uVal=Buffer.concat([uVal,Buffer.alloc(16)]).slice(0,32);

  const oValHex=oVal.toString('hex').toUpperCase();
  const uValHex=uVal.toString('hex').toUpperCase();

  // Parse PDF and encrypt streams
  let pdfStr = pdfBuffer.toString('binary');

  // Collect object numbers and positions
  const objMap = {};
  const objReg = /(\d+) (\d+) obj/g;
  let m;
  while((m=objReg.exec(pdfStr))!==null) objMap[m.index]=parseInt(m[1]);

  // Encrypt streams
  pdfStr = pdfStr.replace(/(\d+ \d+ obj[\s\S]*?stream\r?\n)([\s\S]*?)(\r?\nendstream)/g, (match, hdr, content, ftr, offset) => {
    let objNum = 1;
    for(const pos of Object.keys(objMap).map(Number).sort((a,b)=>a-b)){
      if(pos<=offset) objNum=objMap[pos];
    }
    const objKeyBuf = Buffer.alloc(KL+5);
    eKey.copy(objKeyBuf);
    objKeyBuf.writeUIntLE(objNum,KL,3);
    objKeyBuf.writeUIntLE(0,KL+3,2);
    const objKey = createHash('md5').update(objKeyBuf).digest().slice(0,Math.min(KL+5,16));
    const enc = rc4(objKey, Buffer.from(content,'binary'));
    return hdr + enc.toString('binary') + ftr;
  });

  // Find highest object number
  const allObjs = [...pdfStr.matchAll(/^(\d+) \d+ obj/gm)];
  const maxObj = allObjs.reduce((max,m)=>Math.max(max,parseInt(m[1])),0);
  const encObjNum = maxObj + 1;

  const encDict = `${encObjNum} 0 obj\n<<\n/Filter /Standard\n/V 2\n/R 3\n/Length ${KL*8}\n/P ${permissions}\n/O <${oValHex}>\n/U <${uValHex}>\n>>\nendobj\n`;

  // Update trailer
  pdfStr = pdfStr.replace(/trailer[\s\n]*<</, `trailer\n<<\n/Encrypt ${encObjNum} 0 R\n/ID [<${fileIdHex}><${fileIdHex}>]`);

  // Remove existing /ID if duplicate
  pdfStr = pdfStr.replace(/\/ID \[<[^>]+><[^>]+>\]\s*\/ID \[<[^>]+><[^>]+>\]/g, `/ID [<${fileIdHex}><${fileIdHex}>]`);

  // Append encrypt object before %%EOF
  pdfStr = pdfStr.replace(/(%%EOF[\s]*)$/, encDict + '%%EOF\n');

  return Buffer.from(pdfStr, 'binary');
}

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const segment = () => Array.from({length:4},()=>chars[Math.floor(Math.random()*chars.length)]).join('');
  return `${segment()}-${segment()}-${segment()}`;
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
    if(found) console.log(`Session ${sessionId} already processed`);
    return found;
  } catch(err) { console.error('Duplicate check error:',err.message); return false; }
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
    const cmd = new GetObjectCommand({Bucket:BUCKET,Key:key});
    const resp = await s3.send(cmd);
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
  return await pdfDoc.save();
}

async function uploadAndGetSignedUrl(pdfBuffer, filename) {
  const key = `watermarked/${filename}-${Date.now()}.pdf`;
  await s3.send(new PutObjectCommand({Bucket:BUCKET,Key:key,Body:pdfBuffer,ContentType:'application/pdf'}));
  const url = await getSignedUrl(s3,new GetObjectCommand({Bucket:BUCKET,Key:key}),{expiresIn:172800});
  console.log(`URL generated: ${key}`);
  return url;
}

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

    console.log('Payment confirmed:',{customerEmail,stripeName,sessionId});

    if(await isAlreadyProcessed(sessionId)){
      console.log('Duplicate — skipping');
      return res.status(200).json({received:true,skipped:true});
    }

    const {formName,order:professionalOrder} = await lookupFromSheet(customerEmail,stripeName);
    const productLabel = professionalOrder?`Manuel OQLF — ${professionalOrder}`:'Manuel OQLF';
    const pdfPassword = generatePassword();

    console.log(`Form: "${formName}", Stripe: "${stripeName}", Order: "${professionalOrder}"`);

    let downloadUrl=null, pdfAvailable=false;

    if(professionalOrder){
      const pdfResult = await downloadPDF(professionalOrder);
      if(pdfResult){
        console.log('Watermarking...');
        const watermarked = await watermarkPDF(pdfResult.buffer,formName,stripeName,date);
        try {
          console.log('Encrypting with pure JS...');
          const encrypted = encryptPDFBuffer(watermarked,pdfPassword,pdfPassword+'-OWNER');
          downloadUrl = await uploadAndGetSignedUrl(encrypted,pdfResult.filename);
          pdfAvailable = true;
          console.log('PDF delivery complete with encryption!');
        } catch(encErr){
          console.error('Encryption failed, watermark only:',encErr.message);
          downloadUrl = await uploadAndGetSignedUrl(watermarked,pdfResult.filename);
          pdfAvailable = true;
        }
      }
    }

    try {
      const resp = await fetch(PAYGOGPT_FLOW_WEBHOOK,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          contactEmail:customerEmail,
          contactName:formName,
          data:{
            product_label:productLabel,
            professional_order:professionalOrder,
            stripe_name:stripeName,
            amount_cents:amountCents,
            stripe_session_id:sessionId,
            currency,
            download_url:downloadUrl||'',
            pdf_password:pdfPassword,
            pdf_available:pdfAvailable?'yes':'no',
          },
        }),
      });
      if(!resp.ok) console.error('Flow trigger failed:',await resp.text());
      else console.log('Flow 3277 triggered successfully');
    } catch(err){console.error('Flow error:',err.message);}
  }

  res.status(200).json({received:true});
}
