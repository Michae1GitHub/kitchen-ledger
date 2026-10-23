import {SUPABASE_URL,SUPABASE_KEY} from './config.js';
import {seed,approve,receive,adjust} from './domain.js';
import {upgrade,saveRecipe,postSales,voidSales} from './recipes.js';
const LOCAL_KEY='kitchen-ledger-demo-v1';
let session;try{session=JSON.parse(sessionStorage.getItem('kitchen-ledger-session')||'null');}catch{session=null;}
export const connected=()=>!!session?.access_token;
export const currentUser=()=>session?.user?.email||'';
function saveSession(s){session=s;sessionStorage.setItem('kitchen-ledger-session',JSON.stringify(s));}
async function request(path,options={},auth=true){
 if(auth&&!session)throw Error('Sign in to the restaurant app first.');
 if(auth&&session.expires_at<Date.now()/1000+60){const r=await fetch(SUPABASE_URL+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:SUPABASE_KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:session.refresh_token})});const s=await r.json();if(!r.ok){saveSession(null);throw Error('Your session expired. Sign in again.');}saveSession({...s,expires_at:Date.now()/1000+s.expires_in});}
 const response=await fetch(SUPABASE_URL+path,{...options,headers:{apikey:SUPABASE_KEY,...(auth?{Authorization:'Bearer '+session.access_token}:{}),'Content-Type':'application/json',...options.headers}});
 const result=await response.json().catch(()=>null);if(!response.ok){const error=Error(result?.message||result?.msg||result?.error_description||result?.error||`Request failed (${response.status}).`);error.code=result?.code||result?.error_code;throw error;}return result;
}
export async function signIn(email,password){const s=await request('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email,password})},false);saveSession({...s,expires_at:Date.now()/1000+s.expires_in});}
export async function signUp(email,password){const s=await request('/auth/v1/signup?redirect_to='+encodeURIComponent(location.origin+'/'),{method:'POST',body:JSON.stringify({email,password})},false);if(s.access_token)saveSession({...s,expires_at:Date.now()/1000+s.expires_in});return !!s.access_token;}
export async function resendConfirmation(email){return request('/auth/v1/resend?redirect_to='+encodeURIComponent(location.origin+'/'),{method:'POST',body:JSON.stringify({type:'signup',email})},false);}
export async function consumeConfirmation(){
 const params=new URLSearchParams(location.hash.slice(1));if(!params.has('access_token')&&!params.has('error')&&!params.has('error_code'))return null;
 const token=params.get('access_token');history.replaceState(null,'',location.pathname+location.search);
 if(!token||params.has('error')||params.has('error_code'))return {status:'error',message:'This verification link is invalid or has expired. Request a new email below.'};
 try{const user=await request('/auth/v1/user',{headers:{Authorization:'Bearer '+token}},false);if(!user?.email||!(user.email_confirmed_at||user.confirmed_at))throw Error('Unconfirmed email');return {status:'verified',email:user.email};}
 catch{return {status:'error',message:'We could not confirm this verification link. Request a new email or sign in if you already verified your address.'};}
}
export async function signOut(){try{if(session)await request('/auth/v1/logout',{method:'POST'});}finally{saveSession(null);}}
export function demoLoad(){try{const data=JSON.parse(localStorage.getItem(LOCAL_KEY));if(data?.version===1||data?.version===2)return upgrade(data);}catch{}return upgrade(seed());}
export const demoSave=s=>localStorage.setItem(LOCAL_KEY,JSON.stringify(s));
export function resetDemo(){const s=upgrade(seed());demoSave(s);return s;}
export async function cloudLoad(){return request('/rest/v1/rpc/ledger_state',{method:'POST',body:'{}'});}
export async function cloudAction(action,payload){return request('/rest/v1/rpc/ledger_action',{method:'POST',body:JSON.stringify({action,payload})});}
export async function seedCloud(){
 let current=await cloudLoad();const dummy=seed(),mapping=new Map();
 for(const s of dummy.suppliers){const old=current.suppliers.find(x=>x.name===s.name);if(old)mapping.set(s.id,old.id);else{const id=crypto.randomUUID();current=await cloudAction('supplier',{...s,id});mapping.set(s.id,id);}}
 for(const p of dummy.products){const old=current.products.find(x=>x.name===p.name);if(old){if(old.baseUnit!==p.baseUnit||old.trackStock!==p.trackStock)throw Error(`Existing ${p.name} uses different stock settings. Sample import stopped.`);mapping.set(p.id,old.id);}else{const id=crypto.randomUUID();current=await cloudAction('product',{...p,id});mapping.set(p.id,id);if(p.trackStock){const opening=dummy.movements.find(m=>m.productId===p.id)?.quantity||0;if(opening)current=await cloudAction('adjust',{productId:id,quantity:opening,type:'adjustment',reason:'Dummy opening count'});}}}
 for(const i of dummy.invoices){const supplierId=mapping.get(i.supplierId);if(current.invoices.some(x=>x.supplierId===supplierId&&x.number===i.number))continue;current=await cloudAction('save_invoice',{...i,id:crypto.randomUUID(),supplierId,sourceName:'Dummy test invoice',items:i.items.map(l=>({...l,id:crypto.randomUUID(),productId:mapping.get(l.productId)}))});}
 return current;
}
export async function uploadCloud(file,documentId){const path=session.user.id+'/'+documentId+'/'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_');await request('/storage/v1/object/invoices/'+path,{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream'},body:file});return path;}
export async function signedSource(path){const r=await request('/storage/v1/object/sign/invoices/'+path,{method:'POST',body:JSON.stringify({expiresIn:600})});return SUPABASE_URL+'/storage/v1'+r.signedURL;}
async function filesDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open('kitchen-ledger-files',1);r.onupgradeneeded=()=>r.result.createObjectStore('files');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function saveDemoFile(id,file){const db=await filesDB();try{await new Promise((resolve,reject)=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').put(file,id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}finally{db.close();}}
export async function demoFile(id){const db=await filesDB();try{return await new Promise((resolve,reject)=>{const r=db.transaction('files').objectStore('files').get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}}
export function localAction(state,action,payload){const s=structuredClone(state);if(action==='save_invoice'){const old=s.invoices.find(i=>i.id===payload.id);if(old?.status==='approved')throw Error('Approved invoices cannot be edited.');payload.status='draft';payload.revision=(old?.revision||0)+1;const index=s.invoices.findIndex(i=>i.id===payload.id);if(index<0)s.invoices.push(payload);else s.invoices[index]=payload;s.events.push({id:crypto.randomUUID(),invoiceId:payload.id,action:'Draft saved',at:new Date().toISOString()});}else if(action==='approve')approve(s,payload.id);else if(action==='receive')receive(s,payload.id,payload.quantities);else if(action==='adjust')adjust(s,payload.productId,payload.quantity,payload.type,payload.reason);else if(action==='recipe_save')saveRecipe(s,payload);else if(action==='sales_post')postSales(s,payload);else if(action==='sales_void')voidSales(s,payload.id);else if(action==='supplier')s.suppliers.push(payload);else if(action==='product')s.products.push(payload);else throw Error('Unknown action.');demoSave(s);return s;}
