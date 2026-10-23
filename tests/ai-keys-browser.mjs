import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {SUPABASE_URL} from '../web/config.js';
import {server} from '../server.mjs';
await new Promise(r=>server.listen(4194,'127.0.0.1',r));const browser=await chromium.launch({...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{}),headless:true});const context=await browser.newContext();const page=await context.newPage();page.setDefaultTimeout(15000);const calls=[];const errors=[];page.on('pageerror',e=>errors.push(e.message));
await context.route('**/api/ai-status',route=>route.fulfill({json:{configured:true,model:'mock-test-model'}}));
await context.route('**/api/invoice-chat',route=>{calls.push(route.request().headers()['x-google-key']||null);return route.fulfill({json:{answer:'The invoice total is $325.80.',model:'mock-test-model'}});});
await context.route(SUPABASE_URL+'/**',route=>{const url=new URL(route.request().url());if(url.pathname==='/auth/v1/token'){const email=route.request().postDataJSON().email;return route.fulfill({json:{access_token:'synthetic-token',refresh_token:'synthetic-refresh',expires_in:3600,user:{email}}});}if(url.pathname==='/auth/v1/logout')return route.fulfill({json:{}});throw Error('Unexpected test request '+url.pathname);});
const personal='synthetic_personal_key_only_12345';
async function openReview(){await page.getByRole('button',{name:'Invoices',exact:true}).click();await page.locator('tr').filter({hasText:'HF-10482'}).getByRole('button',{name:'Review',exact:true}).click();}
async function ask(){await page.locator('#ai-question').fill('What is the total?');const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/invoice-chat');await page.getByRole('button',{name:'Ask invoice assistant',exact:true}).click();await response;await page.locator('#ai-form button').filter({hasText:'Ask invoice assistant'}).waitFor();}
async function login(email){await page.evaluate(async email=>{const repo=await import('/repository.js');await repo.signIn(email,'synthetic-password-only');},email);await openReview();}
try{
 await page.goto('http://127.0.0.1:4194');await openReview();await page.getByText('Using the shared default key. No personal key is required.',{exact:true}).waitFor();await ask();assert.equal(calls.at(-1),null);
 await page.locator('.ai-panel summary').click();await page.locator('#ai-key').fill(personal);assert.match(await page.locator('#ai-key-status').innerText(),/Using your personal key.*Saved/);await ask();assert.equal(calls.at(-1),personal);
 await page.reload();await openReview();await ask();assert.equal(calls.at(-1),personal,'Personal key must survive page reloads');
 await page.locator('.ai-panel summary').click();await page.getByRole('button',{name:'Forget key',exact:true}).click();await ask();assert.equal(calls.at(-1),null);assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('kitchen-ledger-ai-key-v1:')).length),0);
 await login('one@example.test');await page.locator('.ai-panel summary').click();await page.locator('#ai-key').fill(personal);await ask();assert.equal(calls.at(-1),personal);
 await login('two@example.test');await ask();assert.equal(calls.at(-1),null,'A second account must not inherit the first account key');
 await login('one@example.test');await ask();assert.equal(calls.at(-1),personal,'Returning account must recover its saved key');
 await page.getByRole('button',{name:'Connection & data',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).click();await openReview();await ask();assert.equal(calls.at(-1),null,'Sign-out must clear the previous account key from memory');
 assert.deepEqual(errors,[]);console.log('AI key UI passed: shared default without key entry, persistent personal override/reload, forgetting returns to default, separate account storage and sign-out isolation. Responses are mocked; provider routing is covered by server tests.');
}finally{await browser.close();server.close();}
