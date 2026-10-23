import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';

test('deployable Worker serves embedded app and real AI boundary', async()=>{
 const root=await worker.fetch(new Request('https://ledger.example/'),{});
 assert.equal(root.status,200);assert.match(await root.text(),/Kitchen Ledger/);
 for(const path of ['/app.js','/v2-ui.js','/invoice-ai.js','/v2.css','/upgrade-v2.sql']){
  const asset=await worker.fetch(new Request('https://ledger.example'+path),{});
  assert.equal(asset.status,200,path);assert.ok((await asset.text()).length>100,path);
 }
 const status=await worker.fetch(new Request('https://ledger.example/api/ai-status'),{});
 assert.equal((await status.json()).configured,false);
 const answer=await worker.fetch(new Request('https://ledger.example/api/invoice-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:'What was billed?',invoice:{items:[]}})}),{});
 assert.equal(answer.status,503);assert.equal((await answer.json()).code,'AI_KEY_REQUIRED');
 assert.equal((await worker.fetch(new Request('https://ledger.example/api/unknown'),{})).status,404);
});
