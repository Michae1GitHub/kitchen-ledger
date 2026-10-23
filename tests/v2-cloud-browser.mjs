import {SUPABASE_URL} from '../web/config.js';
// Uses a local PostgreSQL instance behind intercepted Supabase HTTP requests.
// Verifies app/repository/RPC integration, not the live Supabase auth service.
import {chromium} from '@playwright/test';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {server} from '../server.mjs';
const db=new PGlite();
await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('app.user',true),'')::uuid $$; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(bucket_id text,name text); create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;`);
await db.exec(await readFile('supabase/migrations/001_restaurant_ledger.sql','utf8'));await db.exec(await readFile('supabase/migrations/002_recipes_and_sales.sql','utf8'));
const user=crypto.randomUUID();await db.query('insert into auth.users values($1)',[user]);await db.query("select set_config('app.user',$1,false)",[user]);
await new Promise(r=>server.listen(4181,'127.0.0.1',r));
const browser=await chromium.launch({...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{}),headless:true});
const page=await browser.newPage();page.setDefaultTimeout(15000);
try{
 await page.route(SUPABASE_URL+'/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;let result;
  try{if(path==='/auth/v1/token')result={access_token:'test-token',refresh_token:'test-refresh',expires_in:3600,user:{id:user,email:'restaurant-test@example.com'}};
   else if(path.endsWith('/ledger_state'))result=(await db.query('select public.ledger_state() as state')).rows[0].state;
   else if(path.endsWith('/ledger_action')){const data=req.postDataJSON();result=(await db.query('select public.ledger_action($1,$2::jsonb) as state',[data.action,JSON.stringify(data.payload)])).rows[0].state;}
   else throw Error('Unexpected request: '+path);
   await route.fulfill({status:200,json:result});
  }catch(e){await route.fulfill({status:400,json:{message:e.message}});}
 });
 await page.goto('http://127.0.0.1:4181');await page.getByRole('button',{name:'Connection & data',exact:true}).click();
 await page.locator('input[name=email]').fill('restaurant-test@example.com');await page.locator('input[name=password]').fill('dummy-password-123');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByText('Supabase · signed in',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Connection & data',exact:true}).click();page.on('dialog',d=>d.accept());await page.getByRole('button',{name:'Add dummy test data',exact:true}).click();await page.getByText('Dummy test data added to Supabase.',{exact:true}).waitFor();
 let state=(await db.query('select public.ledger_state() as state')).rows[0].state;assert.equal(state.invoices.length,2);assert.equal(state.products.length,5);assert.equal(state.movements.length,4);
 await page.getByRole('button',{name:'Invoices',exact:true}).click();await page.locator('tr').filter({hasText:'HF-10482'}).getByRole('button',{name:'Review',exact:true}).click();await page.getByRole('button',{name:'Approve invoice',exact:true}).click();await page.getByRole('button',{name:'Confirm delivery & update stock'}).waitFor();
 const inputs=page.locator('#receive-form input');await inputs.nth(0).fill('10');await inputs.nth(1).fill('0');await inputs.nth(2).fill('0');await page.getByRole('button',{name:'Confirm delivery & update stock'}).click();await page.getByText('10 received / 30 kg').waitFor();
 await page.reload();await page.getByText('Supabase · signed in',{exact:true}).waitFor();await page.getByRole('button',{name:'Inventory',exact:true}).click();await page.getByRole('cell',{name:'22.00 kg',exact:true}).waitFor();
 await page.getByRole('button',{name:'Connection & data',exact:true}).click();await page.getByRole('button',{name:'Add dummy test data',exact:true}).click();await page.getByText('Dummy test data added to Supabase.',{exact:true}).waitFor();state=(await db.query('select public.ledger_state() as state')).rows[0].state;assert.equal(state.invoices.length,2);assert.equal(state.movements.length,5);
 await page.getByRole('button',{name:'Recipe',exact:true}).click();await page.getByRole('button',{name:'Load hamburger example',exact:true}).click();await page.getByText('Hamburger (example)',{exact:true}).first().waitFor();await page.locator('#sales-recipe-search').fill('Hamburger');await page.getByRole('option').filter({hasText:'Hamburger (example)'}).click();await page.locator('#sales-form input[type=number]').fill('10');await page.getByRole('button',{name:'Post sales & deduct ingredients'}).click();await page.getByText('10 × Hamburger (example)',{exact:false}).waitFor();await page.reload();await page.getByText('Supabase · signed in',{exact:true}).waitFor();await page.getByRole('button',{name:'Inventory',exact:true}).click();await page.getByRole('cell',{name:'6.50 kg',exact:true}).waitFor();await page.getByRole('button',{name:'Recipe',exact:true}).click();await page.getByRole('button',{name:'Void batch',exact:true}).click();await page.getByText('Voided',{exact:true}).waitFor();state=(await db.query('select public.ledger_state() as state')).rows[0].state;assert.equal(state.version,2);assert.equal(state.recipes.length,1);assert.equal(state.sales.length,1);assert.ok(state.sales[0].voidedAt);console.log('V2 cloud integration passed: existing invoice flow, recipe creation, sales deductions, persistent reload and reversal.');
}finally{await browser.close();server.close();await db.close();}
