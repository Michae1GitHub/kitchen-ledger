import {blankLine} from './domain.js';

const units={case:'case',cases:'case',cs:'case',ctn:'case',carton:'case',box:'box',boxes:'box',bx:'box',kg:'kg',kgs:'kg',kilogram:'kg',kilograms:'kg',g:'g',gram:'g',grams:'g',lb:'lb',lbs:'lb',pound:'lb',pounds:'lb',l:'l',liter:'l',liters:'l',litre:'l',litres:'l',ml:'ml',each:'each',ea:'each',pc:'each',pcs:'each',unit:'each',units:'each',bottle:'bottle',bottles:'bottle',pack:'package',package:'package',pkg:'package',bag:'bag',bags:'bag'};
const unit=s=>units[String(s||'').toLowerCase()]||String(s||'').toLowerCase();
const clean=s=>String(s??'').normalize('NFKC').replace(/[−–—]/g,'-').replace(/\u00a0/g,' ').trim();
const key=s=>clean(s).toLowerCase().replace(/[^a-z0-9]/g,'');
const numberToken='(?:[$€£]\\s*|(?:USD|EUR|GBP|CAD|AUD)\\s+)?[-+]?\\d[\\d,.]*(?:\\s*(?:USD|EUR|GBP|CAD|AUD))?';
const summary=/^(?:sub\s*total|grand\s*total|invoice\s*total|total(?:\s+(?:due|tax|amount|charges))?|amount\s*due|balance|(?:sales\s+)?tax|VAT|GST|PST|HST|discount|delivery|shipping|freight|handling|fuel|payment|net\s*\d+|terms|remit|bill\s*to|ship\s*to|thank\s+you)\b/i;

export function parseAmount(input){
 let s=clean(input);if(!s||/%/.test(s))return null;
 let negative=false;if(/^\(.*\)$/.test(s)){negative=true;s=s.slice(1,-1);}
 s=s.replace(/\b(?:USD|EUR|GBP|CAD|AUD|NZD)\b/ig,'').replace(/[$€£\s]/g,'');
 if(!/^[-+]?\d[\d.,]*$/.test(s))return null;
 const dot=s.lastIndexOf('.'),comma=s.lastIndexOf(',');
 if(dot>=0&&comma>=0){const decimal=dot>comma?'.':',';const grouping=decimal==='.'?',':'.';s=s.replaceAll(grouping,'').replace(decimal,'.');}
 else if(comma>=0){if(/^[+-]?\d{1,3}(,\d{3})+$/.test(s))s=s.replaceAll(',','');else if((s.match(/,/g)||[]).length===1)s=s.replace(',','.');else return null;}
 else if((s.match(/\./g)||[]).length>1){if(/^[+-]?\d{1,3}(\.\d{3})+\.\d{1,2}$/.test(s)){const p=s.lastIndexOf('.');s=s.slice(0,p).replaceAll('.','')+s.slice(p);}else return null;}
 const n=Number(s);return Number.isFinite(n)?(negative?-n:n):null;
}

export function parseInvoiceDate(value){
 const text=clean(value);let y,m,d;let match=text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
 if(match){y=+match[1];m=+match[2];d=+match[3];}
 else{
  const names='Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';
  match=text.match(new RegExp('^('+names+')\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b','i'));
  if(match){m=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(match[1].slice(0,3).toLowerCase())+1;d=+match[2];y=+match[3];}
  else{match=text.match(new RegExp('^(\\d{1,2})\\s+('+names+')\\.?[,]?\\s+(\\d{4})\\b','i'));if(match){d=+match[1];m=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(match[2].slice(0,3).toLowerCase())+1;y=+match[3];}
   else{match=text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/);if(!match)return '';const a=+match[1],b=+match[2];if(a<=12&&b<=12&&a!==b)return '';d=a>12?a:b;m=a>12?b:a;y=+match[3];}
  }
 }
 const date=new Date(Date.UTC(y,m-1,d));return date.getUTCFullYear()===y&&date.getUTCMonth()+1===m&&date.getUTCDate()===d?`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`:'';
}

// Preserve rows and page numbers when the recognition engine supplies geometry.
function documentRows(text,layout=[]){if(layout?.length)return layout.map(r=>({...r,text:clean(r.text),rawText:r.rawText??r.text}));let page=1;return String(text).split(/\r?\n/).map(rawText=>{const mark=rawText.match(/--- Page (\d+) ---/);if(mark)page=+mark[1];return {text:clean(rawText),rawText,page};});}
const evidence=row=>({page:row.page||1,rawText:row.rawText,...(row.bbox?{boundingBox:row.bbox}:{}),...(Number.isFinite(row.confidence)?{ocrConfidence:row.confidence}:{})});
function labelValue(rows,label,reject=()=>false,anchored=false){const pattern=new RegExp((anchored?'^':'(?:^|\\s|\\|)')+'(?:'+label+')\\s*(?:[:#=]|\\s[-]\\s)?\\s*(.*)$','i');for(let i=0;i<rows.length;i++){const m=rows[i].text.match(pattern);if(!m)continue;let row=rows[i],value=m[1].replace(/\s+(?:Invoice\s+(?:Date|No\.?|Number)|Due\s+Date|PO\s+Number|Email|Tel|Phone|Bill\s+To|Ship\s+To)\s*[:#].*$/i,'').trim();if(!value&&rows[i+1]&&!summary.test(rows[i+1].text)){value=rows[i+1].text;row={...row,rawText:row.rawText+'\n'+rows[i+1].rawText};}if(reject(value))continue;return {value,row};}return null;}
function amountInLabel(rows,label){const prefix='^(?:'+label+')(?:\\s*\\([^)]*\\)|\\s*(?:@\\s*)?\\d+(?:[.,]\\d+)?\\s*%)?';const re=new RegExp(prefix+'\\s*[:=]?\\s*('+numberToken+')\\s*$','i'),labelOnly=new RegExp(prefix+'\\s*[:=]?\\s*$','i');const result=[];for(let i=0;i<rows.length;i++){const row=rows[i],m=row.text.match(re);if(m){const value=parseAmount(m[1]);if(value!==null)result.push({value,row});}else if(labelOnly.test(row.text)&&rows[i+1]){const value=parseAmount(rows[i+1].text);if(value!==null)result.push({value,row:{...row,rawText:row.rawText+'\n'+rows[i+1].rawText}});}}return result;}

export function parseInvoiceHeaders(text,state,layout=[]){
 const rows=documentRows(text,layout),warnings=[],fieldEvidence={};
 const labels={number:'(?:tax\\s+)?(?:invoice|invoi|invo[il1]ce|[in]y[o0][il1]ce|inv\\.?|bill)\\s*(?:number|no\\.?|id|#)',date:'(?:invoice\\s+date|date\\s+issued|issue\\s+date|date)',dueDate:'(?:due\\s+date|payment\\s+due|due)',purchaseOrderReference:'(?:P\\.?O\\.?|purchase\\s+order)\\s*(?:number|no\\.?|#)?'};
 const headers={number:'',date:'',dueDate:'',purchaseOrderReference:'',extractedSupplierName:'',extractedEmail:'',supplierId:''};
 for(const [field,label]of Object.entries(labels)){const candidates=field==='number'?rows.filter(r=>!/^please\b|\binclude.*payment\b/i.test(r.text)):rows;const reject=field==='number'?v=>/^(with|on|in|for|when|and|to|should|must|is|date|due|subtotal|total|email|supplier|description|qty)\b/i.test(v):()=>false;const found=field==='date'?(labelValue(rows,'invoice\\s+date|date\\s+issued|issue\\s+date')||labelValue(rows,'date',()=>false,true)):labelValue(candidates,label,reject);if(!found)continue;fieldEvidence[field]=evidence(found.row);if(field==='date'||field==='dueDate'){headers[field]=parseInvoiceDate(found.value);if(!headers[field])warnings.push(`The ${field==='date'?'invoice':'due'} date "${found.value}" is ambiguous or invalid; enter it after checking the source.`);}else headers[field]=found.value.match(/^[A-Z0-9][A-Z0-9._/-]*/i)?.[0]||'';}
 // Invoice: ABC is common, but avoid treating Invoice Date as an identifier.
 if(!headers.number){const found=labelValue(rows,'invoice\\s*:');if(found&&!/^(date|total|amount|number)\b/i.test(found.value)){headers.number=found.value.match(/^[A-Z0-9][A-Z0-9._/-]*/i)?.[0]||'';fieldEvidence.number=evidence(found.row);}}
 const vendor=labelValue(rows,'(?:supplier|vendor)(?:\\s+name)?|sold\\s+by|remit(?:\\s+payments?)?\\s+to|from',()=>false,true);
 if(vendor){headers.extractedSupplierName=vendor.value.split(/\s{2,}/)[0].replace(/\s+(?:thank(?:\s+you)?|please include|quality ingredients).*$/i,'').trim();fieldEvidence.extractedSupplierName=evidence(vendor.row);}
 const email=labelValue(rows,'e-?mail');if(email){headers.extractedEmail=email.value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]||'';fieldEvidence.extractedEmail=evidence(email.row);}
 if(!headers.extractedSupplierName){const heading=rows.slice(0,8).find(r=>r.text.length>3&&/[a-z]/i.test(r.text)&&!/(invoice|date|number|\bno\b|\bqty\b|@|www\.|\d|bill to|ship to|food supply$)/i.test(r.text));if(heading){headers.extractedSupplierName=heading.text;fieldEvidence.extractedSupplierName=evidence(heading);warnings.push('Supplier name inferred from the heading; confirm it before creating a supplier.');}}
 const matches=state.suppliers.filter(s=>(headers.extractedSupplierName&&key(s.name)===key(headers.extractedSupplierName))||(headers.extractedEmail&&s.email?.toLowerCase()===headers.extractedEmail.toLowerCase()));
 if(matches.length===1)headers.supplierId=matches[0].id;
 else if(!headers.extractedSupplierName){const top=rows.slice(0,12).map(r=>r.text).join('\n').toLowerCase();const known=state.suppliers.filter(s=>top.includes(s.name.toLowerCase()));if(known.length===1){headers.supplierId=known[0].id;headers.extractedSupplierName=known[0].name;}}
 const subtotal=amountInLabel(rows,'sub\\s*total|net\\s+(?:amount|total)|total\\s+before\\s+tax').at(-1);if(subtotal){headers.subtotal=subtotal.value;fieldEvidence.subtotal=evidence(subtotal.row);}
 const totalGroups=['grand\\s+total|invoice\\s+total|total\\s+(?:invoice|amount)','total','amount\\s+due|total\\s+due'];
 for(const label of totalGroups){const found=amountInLabel(rows,label).at(-1);if(found){headers.total=found.value;fieldEvidence.total=evidence(found.row);break;}}
 const taxTotal=amountInLabel(rows,'total\\s+tax|tax\\s+total').at(-1);
 const taxes=amountInLabel(rows,'(?:sales\\s+)?tax|VAT|GST|PST|HST|CGST|SGST');
 if(taxTotal){headers.tax=taxTotal.value;fieldEvidence.tax=evidence(taxTotal.row);}else if(taxes.length){const unique=[...new Map(taxes.map(t=>[key(t.row.text),t])).values()];headers.tax=Math.round(unique.reduce((a,t)=>a+t.value,0)*100)/100;fieldEvidence.tax=unique.map(t=>evidence(t.row));}
 const chargeTotal=amountInLabel(rows,'total\\s+(?:charges|fees)|charges\\s+total').at(-1),fees=amountInLabel(rows,'delivery(?:\\s+(?:fee|charge))?|shipping(?:\\s+(?:fee|charge))?|freight|handling(?:\\s+(?:fee|charge))?|fuel\\s+(?:fee|charge|surcharge)');
 if(chargeTotal){headers.charges=chargeTotal.value;fieldEvidence.charges=evidence(chargeTotal.row);}else if(fees.length){const unique=[...new Map(fees.map(t=>[key(t.row.text),t])).values()];headers.charges=Math.round(unique.reduce((a,t)=>a+t.value,0)*100)/100;fieldEvidence.charges=unique.map(t=>evidence(t.row));}
 const discount=amountInLabel(rows,'discount(?:\\s+amount)?').at(-1);if(discount){headers.discount=Math.abs(discount.value);fieldEvidence.discount=evidence(discount.row);}
 const codes=new Set([...text.matchAll(/\b(USD|EUR|GBP|CAD|AUD|NZD)\b/g)].map(m=>m[1]));if(text.includes('€'))codes.add('EUR');if(text.includes('£'))codes.add('GBP');if(codes.size===1)headers.currency=[...codes][0];else if(codes.size>1){headers.currency='UNRESOLVED';warnings.push('Multiple currencies appear in the document. Confirm the invoice currency.');}
 return {...headers,fieldEvidence,extractionWarnings:warnings};
}

function matchProduct(description,state){const matches=state.products.filter(p=>new RegExp('(?:^|\\W)'+p.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:$|\\W)','i').test(description));return matches.length===1?matches[0]:null;}
const headerKeys={supplierCode:['sku','itemcode','productcode','itemnumber','itemno','code'],description:['description','itemdescription','productdescription','product','item'],quantity:['quantity','qty','qnty','ordered','billedqty'],billingUnit:['unit','uom'],price:['unitprice','price','rate','cost','unitcost'],amount:['linetotal','extendedprice','extendedamount','amount','total'],packDescription:['pack','packsize','size']};
function columnName(label){const k=key(label);return Object.entries(headerKeys).find(([,aliases])=>aliases.includes(k))?.[0];}
function cells(text){return text.includes('|')?text.split('|').map(s=>s.trim()).filter((s,i,a)=>s||i>0&&i<a.length-1):text.split(/\t+|\s{2,}/).map(s=>s.trim());}
function tableHeader(row){const parts=cells(row.text),map=parts.map(columnName);return map.includes('description')&&map.includes('quantity')&&(map.includes('price')||map.includes('amount'))?{map,parts}:null;}
function lineFrom(values,row,state,notes=[]){
 const description=String(values.description||'').trim();if(!description||!/[a-z]/i.test(description)||summary.test(description))return null;
 const q=String(values.quantity||'').match(/^([-+]?\d+(?:[.,]\d+)?)([\]|]?)$/);if(!q)return null;
 const quantity=parseAmount(q[1]),amount=parseAmount(values.amount),price=parseAmount(values.price);if(quantity===null||amount===null&&price===null)return null;
 const product=matchProduct(description,state),explicit=!!values.billingUnit,billingUnit=unit(values.billingUnit)||(/\bcase\b/i.test(description)?'case':'package');
 const line={...blankLine(),description,supplierCode:String(values.supplierCode||''),productId:product?.id||'',quantity,billingUnit,price:price??(quantity?amount/quantity:0),amount:amount??quantity*price,shippedQuantity:quantity,shippedUnit:billingUnit,baseQuantity:explicit&&product?.baseUnit===billingUnit?quantity:0,packDescription:values.packDescription||description.match(/\(([^)]+)\)/)?.[1]||'',evidence:evidence(row),extractionNotes:[...(q[2]?['OCR punctuation after quantity was removed; verify against the original.']:[]),...notes]};
 if(price===null)line.extractionNotes.push('Unit price calculated from printed amount and quantity; verify it.');if(amount===null)line.extractionNotes.push('Line amount calculated from quantity and unit price; verify it.');
 if(!explicit)line.extractionNotes.push('Confirm the billing package and stock conversion.');
 return line;
}

export function parseInvoiceLines(text,state,layout=[]){
 const rows=documentRows(text,layout),lines=[];let columns=null,inTable=false,pending=[];
 const unitPattern=Object.keys(units).sort((a,b)=>b.length-a.length).join('|');
 const measured=new RegExp('^(.+?)\\s+(\\d+(?:[.,]\\d+)?)\\s*('+unitPattern+')\\s*(?:/\\s*(\\d+(?:[.,]\\d+)?)\\s*(kg|lb|g))?\\s+(?:[×x]\\s*)?('+numberToken+')(?:\\s*/\\s*('+unitPattern+'))?\\s*(?:=\\s*)?('+numberToken+')\\s*$','i');
 const generic=new RegExp('^(.+?)\\s+(\\d+(?:[.,]\\d+)?[\\]|]?)\\s+(?:('+unitPattern+')\\s+)?('+numberToken+')\\s+('+numberToken+')\\s*$','i');
 for(const row of rows){const raw=row.text;if(!raw||/^--- Page/.test(raw))continue;const header=tableHeader(row);
  if(header){columns=header;inTable=true;pending=[];continue;}
  if(/description/i.test(raw)&&/\b(qty|quantity)\b/i.test(raw)&&/\b(price|rate|amount|total)\b/i.test(raw)){inTable=true;columns=null;pending=[];continue;}
  if(summary.test(raw)){inTable=false;columns=null;pending=[];continue;}
  let line;
  const parts=cells(raw);
  if(columns&&parts.length===columns.map.length){const values={};columns.map.forEach((name,i)=>{if(name)values[name]=parts[i];});line=lineFrom(values,row,state);}
  const normalized=raw.replace(/\s+\|\s+/g,' ');const m=!line&&normalized.match(measured);
  if(m){const description=m[1],product=matchProduct(description,state),shippedQuantity=parseAmount(m[2]),shippedUnit=unit(m[3]),billingUnit=unit(m[7]||m[5]||m[3]),quantity=m[4]?parseAmount(m[4]):billingUnit===shippedUnit?shippedQuantity:0;line={...blankLine(),description,supplierCode:description.match(/^([A-Z]{2,}[-\d][A-Z\d-]*)\s+/)?.[1]||'',productId:product?.id||'',quantity,billingUnit,price:parseAmount(m[6]),amount:parseAmount(m[8]),shippedQuantity,shippedUnit,baseQuantity:product?.baseUnit===billingUnit?quantity:0,evidence:evidence(row)};}
  if(!line){const m=normalized.match(generic);if(m&&(inTable||/[$€£]|\b(?:USD|EUR|GBP)\b/.test(m[4]+m[5])||/^[A-Z][A-Z0-9]*[-]\w+\s/.test(m[1]))){const description=m[1],code=description.match(/^([A-Z][A-Z0-9]*[-][A-Z0-9-]+)\s+(.+)/i);line=lineFrom({description:code?code[2]:description,supplierCode:code?.[1],quantity:m[2],billingUnit:m[3],price:m[4],amount:m[5]},row,state);}}
  if(!line&&pending.length){const joined={...row,text:pending.map(r=>r.text).join(' ')+' '+raw,rawText:pending.map(r=>r.rawText).join('\n')+'\n'+row.rawText};const m=joined.text.match(generic);if(m)line=lineFrom({description:m[1],quantity:m[2],billingUnit:m[3],price:m[4],amount:m[5]},joined,state,['Description joined across document rows; verify it.']);}
  if(line){lines.push(line);inTable=true;pending=[];continue;}
  if(inTable&&/[a-z]/i.test(raw)&&!/:|@|www\.|\b(invoice|date|number)\b/i.test(raw)&&!new RegExp(numberToken+'\\s*$','i').test(raw)){if(lines.length&&lines.at(-1).evidence.page===(row.page||1)){lines.at(-1).description+=' '+raw;lines.at(-1).evidence.rawText+='\n'+row.rawText;lines.at(-1).extractionNotes=[...(lines.at(-1).extractionNotes||[]),'Wrapped description joined; verify it.'];}else pending.push(row);}
 }
 return lines;
}

// A geometric row reconstruction works for both OCR words and PDF text spans.
export function reconstructRows(spans,page=1){
 const cleanSpans=spans.filter(w=>String(w.text||'').trim()&&w.bbox&&['x0','y0','x1','y1'].every(k=>Number.isFinite(w.bbox[k]))&&w.bbox.x1>=w.bbox.x0&&w.bbox.y1>=w.bbox.y0).map(w=>({...w,text:clean(w.text)}));
 cleanSpans.sort((a,b)=>(a.bbox.y0+a.bbox.y1-b.bbox.y0-b.bbox.y1)/2||a.bbox.x0-b.bbox.x0);
 const rows=[];
 for(const word of cleanSpans){const height=Math.max(1,word.bbox.y1-word.bbox.y0),center=(word.bbox.y1+word.bbox.y0)/2;let row=rows.findLast(r=>Math.abs(r.center-center)<=Math.max(2,Math.min(r.height,height)*.5));if(!row){row={center,height,words:[]};rows.push(row);}row.words.push(word);row.center=row.words.reduce((a,w)=>a+(w.bbox.y0+w.bbox.y1)/2,0)/row.words.length;}
 return rows.sort((a,b)=>a.center-b.center).map(r=>{r.words.sort((a,b)=>a.bbox.x0-b.bbox.x0);let text='';for(let i=0;i<r.words.length;i++){const w=r.words[i],previous=r.words[i-1];const gap=previous?w.bbox.x0-previous.bbox.x1:0;const avg=previous?(previous.bbox.x1-previous.bbox.x0)/Math.max(1,previous.text.length):0;text+=(i?(gap>Math.max(r.height*.8,avg*2.5)?'  ':' '):'')+w.text;}const confidences=r.words.map(w=>w.confidence).filter(Number.isFinite);return {text,rawText:text,page,bbox:{x0:Math.min(...r.words.map(w=>w.bbox.x0)),y0:Math.min(...r.words.map(w=>w.bbox.y0)),x1:Math.max(...r.words.map(w=>w.bbox.x1)),y1:Math.max(...r.words.map(w=>w.bbox.y1))},...(confidences.length?{confidence:confidences.reduce((a,b)=>a+b,0)/confidences.length}:{}),words:r.words};});
}
