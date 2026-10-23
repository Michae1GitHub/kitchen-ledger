import {blankInvoice,blankLine,uid} from './domain.js';
let tesseract;
const unitNames={cases:'case',case:'case',kg:'kg',kgs:'kg',kilograms:'kg',g:'g',grams:'g',lb:'lb',lbs:'lb',each:'each',ea:'each',units:'each',liters:'l',litres:'l',l:'l',boxes:'box',box:'box'};
const unit=u=>unitNames[String(u).toLowerCase()]||String(u).toLowerCase();
const amountValue=s=>Number(String(s).replaceAll(',',''));
const itemMatch=(description,state)=>{const key=description.toLowerCase();const matches=state.products.filter(p=>key.includes(p.name.toLowerCase()));return matches.length===1?matches[0]:null;};
export function parseInvoiceDate(value){
 const text=String(value||'').trim();let year,month,day;
 const iso=text.match(/^(\d{4})-(\d{2})-(\d{2})(?:\b|$)/);
 if(iso)[,year,month,day]=iso.map(Number);
 else{
  const m=text.match(/^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2}),?\s+(\d{4})(?:\b|$)/i);
  if(!m)return '';month=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[1].slice(0,3).toLowerCase())+1;day=Number(m[2]);year=Number(m[3]);
 }
 const date=new Date(Date.UTC(year,month-1,day));if(date.getUTCFullYear()!==year||date.getUTCMonth()+1!==month||date.getUTCDate()!==day)return '';
 return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
export function parseInvoiceHeaders(text,state){
 const numberLabel=/(?:invoice|invo[il1]ce|[in]y[o0][il1]ce)\s*(?:number|no\.?|#|:)\s*[:#]?\s*([A-Z0-9][A-Z0-9._/-]*)/i;
 const valueAfter=label=>text.match(new RegExp(label+'\\s*:\\s*([^\\n]+)','i'))?.[1]?.trim()||'';
 const extractedEmail=valueAfter('email').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]||'';
 const remit=text.match(/remit\s+payments?\s+to\s*:\s*\n?([^\n]+)/i)?.[1]||'';
 const extractedSupplierName=(valueAfter('(?:supplier|vendor)(?:\\s+name)?')||remit).replace(/\s+(?:thank you|please include|quality ingredients).*$/i,'').trim();
 const normalized=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
 const supplierMatches=state.suppliers.filter(s=>(extractedSupplierName&&normalized(s.name)===normalized(extractedSupplierName))||(extractedEmail&&s.email?.toLowerCase()===extractedEmail.toLowerCase())||text.toLowerCase().includes(s.name.toLowerCase()));
 const headers={number:text.match(numberLabel)?.[1]||'',date:parseInvoiceDate(valueAfter('(?:invoice\\s+)?date')),dueDate:parseInvoiceDate(valueAfter('due(?:\\s+date)?')),purchaseOrderReference:valueAfter('(?:PO|purchase\\s+order)(?:\\s+(?:number|no\\.?))?').split(/\s+/)[0]||'',extractedSupplierName,extractedEmail,supplierId:supplierMatches.length===1?supplierMatches[0].id:''};
 const patterns={subtotal:'sub\\s*total',tax:'(?:sales\\s+)?tax(?:\\s*\\([^)]*\\))?',total:'(?:grand\\s+|invoice\\s+)?total',discount:'discount(?:\\s*\\([^)]*\\))?'};
 for(const [key,label]of Object.entries(patterns)){const regex=new RegExp('(?:^|\\n)\\s*'+label+'\\s*:\\s*\\$?([\\d,]+(?:\\.\\d{1,2})?)','ig');const matches=[...text.matchAll(regex)];if(matches.length)headers[key]=amountValue(matches.at(-1)[1]);}
 const fees=[...text.matchAll(/(?:^|\n)\s*(?:delivery\s+(?:fee|charge)|shipping(?:\s+(?:fee|charge))?|freight|handling(?:\s+(?:fee|charge))?|fuel\s+(?:fee|charge|surcharge))\s*:\s*\$?([\d,]+(?:\.\d{1,2})?)/ig)];
 if(fees.length)headers.charges=Math.round(fees.reduce((sum,m)=>sum+amountValue(m[1]),0)*100)/100;
 return headers;
}
export function parseInvoiceLines(text,state){
 const lines=[];let page=1;
 // Conservative row grammar: description + quantity/unit + unit price + amount.
 // Ambiguous rows stay in source text and are entered manually during review.
 const row=/^(.+?)\s+(\d+(?:\.\d+)?)\s*(cases?|kgs?|kilograms|g|grams|lbs?|each|ea|units|liters|litres|l|boxes|box)\s*(?:\/\s*(\d+(?:\.\d+)?)\s*(kg|lb|g))?\s+(?:[×x]\s*)?\$([\d,]+(?:\.\d{1,4})?)(?:\s*\/\s*(case|kg|lb|g|each|ea|l|box))?\s*(?:=\s*)?\$([\d,]+(?:\.\d{1,2})?)\s*$/i;
 const tableRow=/^([A-Z][A-Z0-9]*[-][A-Z0-9-]+)\s+(.+?)\s+(\d+(?:\.\d+)?)([\]|]?)\s+\$([\d,]+(?:\.\d{1,4})?)\s+\$([\d,]+(?:\.\d{1,2})?)\s*$/i;
 for(const raw of text.split(/\r?\n/)){const mark=raw.match(/--- Page (\d+) ---/);if(mark){page=Number(mark[1]);continue;}const cleaned=raw.trim().replace(/\s+\|\s+/g,' ');const m=cleaned.match(row);if(!m){
  const t=cleaned.match(tableRow);if(!t)continue;
  const description=t[2],quantity=Number(t[3]),product=itemMatch(description,state),billingUnit=/\bcase\b/i.test(description)?'case':'package';
  lines.push({...blankLine(),description,supplierCode:t[1],productId:product?.id||'',quantity,billingUnit,price:amountValue(t[5]),amount:amountValue(t[6]),shippedQuantity:quantity,shippedUnit:billingUnit,baseQuantity:0,packDescription:description.match(/\(([^)]+)\)/)?.[1]||'',extractionNotes:[...(t[4]?['OCR punctuation after quantity was removed; verify against the original.']:[]),'Confirm the billing package and stock conversion.'],evidence:{page,rawText:raw}});continue;
 }
  const description=m[1].trim();if(/^(subtotal|total|tax|discount|shipping|balance)\b/i.test(description))continue;
  const shippedQuantity=Number(m[2]),shippedUnit=unit(m[3]);const actualWeight=m[4]?Number(m[4]):null;
  const billingUnit=unit(m[7]||m[5]||m[3]);
  // A price per kg with a case quantity but no actual weight is unresolved.
  const quantity=actualWeight??(billingUnit===shippedUnit?shippedQuantity:0);
  const product=itemMatch(description,state);
  const code=description.match(/^([A-Z]{2,}[-\d][A-Z\d-]*)\s+/)?.[1]||'';
  const line={...blankLine(),description,supplierCode:code,productId:product?.id||'',quantity,billingUnit,price:Number(m[6].replaceAll(',','')),amount:Number(m[8].replaceAll(',','')),shippedQuantity,shippedUnit,baseQuantity:product?.baseUnit===billingUnit?quantity:0,evidence:{page,rawText:raw}};
  lines.push(line);
 }
 return lines;
}
async function imageOCR(image,progress){if(!tesseract){tesseract=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js';script.onload=()=>resolve(window.Tesseract);script.onerror=()=>{tesseract=null;reject(Error('Could not load OCR. Check your internet connection or use manual entry.'));};document.head.append(script);});}const T=await tesseract;const worker=await T.createWorker('eng',1,{logger:m=>{if(m.status)progress(m.status+(m.progress?' '+Math.round(m.progress*100)+'%':''));}});try{return(await worker.recognize(image)).data.text;}finally{await worker.terminate();}}
export async function extractText(file,progress){
 if(file.size>20*1024*1024)throw Error('Upload a file smaller than 20 MB.');
 if(file.type==='application/json'||file.name.endsWith('.json'))return {json:JSON.parse(await file.text())};
 if(file.type==='text/plain'||file.name.endsWith('.txt'))return {text:await file.text()};
 if(file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf')){
  const pdfjs=await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs');pdfjs.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
  const pdf=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
  try{if(pdf.numPages>10)throw Error('First version: PDFs must have 10 pages or fewer.');let text='';for(let n=1;n<=pdf.numPages;n++){progress(`Reading page ${n} of ${pdf.numPages}`);const page=await pdf.getPage(n);const content=await page.getTextContent();let pageText=content.items.map(x=>x.str+(x.hasEOL?'\n':' ')).join('');if(pageText.trim().length<30){const viewport=page.getViewport({scale:2});if(viewport.width*viewport.height>20000000)throw Error('PDF page is too large. Upload a smaller scan.');const canvas=document.createElement('canvas');canvas.width=viewport.width;canvas.height=viewport.height;await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;pageText=await imageOCR(canvas,progress);}text+=`\n--- Page ${n} ---\n`+pageText;}return {text};}finally{await pdf.destroy();}
 }
 if(['image/png','image/jpeg','image/webp'].includes(file.type))return {text:await imageOCR(file,progress)};
 throw Error('Choose PDF, JPG, PNG, WebP, TXT, or the sample JSON.');
}
export function parseExtraction(result,state,file){const invoice=blankInvoice();invoice.sourceName=file.name;
 if(result.json){const input=result.json;if(!Array.isArray(input.items)||input.items.length>200)throw Error('Sample JSON must contain an items array (maximum 200 lines).');for(const k of ['number','date','dueDate','currency','subtotal','tax','charges','discount','total'])if(input[k]!==undefined)invoice[k]=input[k];invoice.supplierId=state.suppliers.find(s=>s.name.toLowerCase()===String(input.supplier||'').toLowerCase())?.id||'';invoice.items=input.items.map(l=>({...blankLine(),description:String(l.description||''),supplierCode:String(l.supplierCode||''),productId:state.products.find(p=>p.name.toLowerCase()===String(l.product||'').toLowerCase())?.id||'',quantity:Number(l.quantity),billingUnit:String(l.billingUnit||'case'),price:Number(l.price),amount:Number(l.amount),shippedQuantity:Number(l.shippedQuantity??l.quantity),shippedUnit:String(l.shippedUnit||l.billingUnit||'case'),baseQuantity:Number(l.baseQuantity||0)}));invoice.sourceText=JSON.stringify(input,null,2);}
 else{const t=result.text;invoice.sourceText=t;Object.assign(invoice,parseInvoiceHeaders(t,state));invoice.items=parseInvoiceLines(t,state);if(!invoice.items.length)invoice.items=[blankLine()];}
 invoice.id=uid();return invoice;
}
