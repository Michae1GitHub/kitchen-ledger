import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {seed} from '../web/domain.js';
import {server} from '../server.mjs';

const fixture=seed(),template=fixture.invoices[0];fixture.version=2;fixture.events=[];
const number=n=>String(n).padStart(2,'0');
fixture.products=Array.from({length:23},(_,k)=>({...fixture.products[0],id:'product-'+k,name:'Ingredient '+number(k+1),category:k===22?'Special category':'Dry goods'}));
fixture.suppliers=Array.from({length:23},(_,k)=>({id:'supplier-'+k,name:'Supplier '+number(k+1),account:'ACCOUNT-'+number(k+1),email:'supplier'+number(k+1)+'@example.test'}));
fixture.invoices=Array.from({length:23},(_,k)=>({...structuredClone(template),id:'invoice-'+k,supplierId:fixture.suppliers[k].id,number:'INV-'+number(k+1),status:'approved',items:[{...template.items[0],id:'line-'+k,productId:fixture.products[k].id,description:fixture.products[k].name}]}));
fixture.movements=Array.from({length:23},(_,k)=>({id:'movement-'+k,productId:fixture.products[0].id,quantity:1000,type:'opening',reason:'Opening '+number(k+1),at:'2026-09-'+number(k+1)+'T12:00:00Z'}));
fixture.recipes=Array.from({length:23},(_,k)=>({id:'recipe-'+k,name:'Dish '+number(k+1),yieldServings:1,revision:1,ingredients:[{productId:fixture.products[0].id,quantity:1,unit:'g'}]}));
fixture.sales=Array.from({length:23},(_,k)=>({id:'sale-'+k,date:'2026-08-'+number(k+1),entries:[{recipeId:fixture.recipes[k].id,name:fixture.recipes[k].name,servings:1}],usage:[{name:'Ingredient 01',quantity:.001,unit:'kg'}],note:'Historical batch '+number(k+1),voidedAt:'2026-09-01T12:00:00Z'}));
await new Promise(r=>server.listen(4188,'127.0.0.1',r));const browser=await chromium.launch({...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{}),headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addInitScript(data=>localStorage.setItem('kitchen-ledger-demo-v1',JSON.stringify(data)),fixture);
const page=await context.newPage();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
const region=id=>page.locator(`[data-entry-list="${id}"]`);
const pager=label=>page.getByRole('navigation',{name:label+' pages',exact:true});
async function threePages(id,label,selector){
 assert.equal(await region(id).locator(selector).count(),10,id+' page 1');
 await pager(label).getByRole('button',{name:'Next '+label+' page',exact:true}).click();assert.equal(await region(id).locator(selector).count(),10,id+' page 2');
 await pager(label).getByRole('button',{name:'Next '+label+' page',exact:true}).click();assert.equal(await region(id).locator(selector).count(),3,id+' page 3');
 assert.ok(await pager(label).getByRole('button',{name:'Next '+label+' page',exact:true}).isDisabled());
}
async function search(id,text,expected,selector){
 await page.locator('#list-search-'+id).fill(text);assert.equal(await region(id).locator(selector).count(),expected,id+' search');
}
try{
 await page.goto('http://127.0.0.1:4188');
 await threePages('review-board','review board','tbody tr');await search('review-board','INV-01',1,'tbody tr');
 await region('review-board').getByRole('button',{name:'View / receive',exact:true}).click();await page.getByRole('heading',{name:'INV-01',exact:true}).waitFor();await page.getByRole('button',{name:'← All invoices'}).click();
 await threePages('invoices','invoices','tbody tr');await search('invoices','supplier 01',1,'tbody tr');await search('invoices','no such invoice',0,'tbody tr');
 await page.getByRole('button',{name:'Inventory',exact:true}).click();
 await threePages('inventory-items','inventory items','tbody tr');await search('inventory-items','special category',1,'tbody tr');await search('inventory-items','<script>',0,'tbody tr');
 await threePages('inventory-summary','inventory changes','tbody tr');await search('inventory-summary','Ingredient 23',1,'tbody tr');await region('inventory-summary').getByRole('button',{name:'View changes for Ingredient 23'}).click();assert.equal(await page.locator('#chart-product-search').inputValue(),'Ingredient 23');
 assert.equal(await page.locator('#chart-product').count(),0);assert.equal(await page.locator('#list-search-inventory-days').count(),0);assert.equal(await pager('daily inventory changes').count(),0);
 await page.locator('#chart-product-search').fill('Ingredient 01');await page.locator('#chart-product-search').press('ArrowDown');await page.locator('#chart-product-search').press('Enter');assert.equal(await page.locator('#chart-product-search').inputValue(),'Ingredient 01');await page.locator('#daily-movement-data summary').click();assert.equal(await region('inventory-days').locator('tbody tr').count(),23);assert.equal(await page.locator('svg.stock-chart g').count(),23);
 await page.locator('#chart-start').fill('2026-09-20');await page.locator('#chart-start').dispatchEvent('change');await page.locator('#daily-movement-data summary').click();assert.equal(await region('inventory-days').locator('tbody tr').count(),4);assert.equal(await page.locator('svg.stock-chart g').count(),4);await page.locator('#chart-start').fill('');await page.locator('#chart-start').dispatchEvent('change');
 await page.locator('#adjust-form input[name=reason]').fill('Unsaved reason');await threePages('stock-movements','stock movements','.activity');assert.equal(await page.locator('#adjust-form input[name=reason]').inputValue(),'Unsaved reason');await search('stock-movements','Opening 23',1,'.activity');
 await page.getByRole('button',{name:'Suppliers',exact:true}).click();await threePages('suppliers','suppliers','tbody tr');await search('suppliers','ACCOUNT-01',1,'tbody tr');
 await page.getByRole('button',{name:'Reports',exact:true}).click();await threePages('supplier-prices','supplier price history','tbody tr');await search('supplier-prices','Supplier 01',1,'tbody tr');
 // Searching does not change whole-workspace totals or export rows.
 assert.match(await page.locator('.stats').innerText(),/23/);const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export approved invoices'}).click();const download=await downloadPromise;let csv='';for await(const chunk of await download.createReadStream())csv+=chunk;assert.equal(csv.trim().split('\r\n').length,24);
 await page.getByRole('button',{name:'Recipe',exact:true}).click();await threePages('recipes','recipes','.recipe-card');await search('recipes','Dish 01',1,'.recipe-card');
 await threePages('sales-history','sales history','.activity');await search('sales-history','Historical batch 01',1,'.activity');
 const count=name=>page.locator(`#sales-form input[name="count.${name}"]`);
 assert.equal(await region('sales-recipes').locator('input').count(),0);assert.equal(await pager('sales recipes').count(),0);assert.ok(await page.locator('#post-sales').isDisabled());
 await page.locator('#sales-recipe-search').fill('Dish');assert.equal(await page.locator('#sales-recipe-search-results [role=option]').count(),10);await page.locator('#sales-recipe-search').press('Escape');assert.equal(await region('sales-recipes').locator('input').count(),0);
 async function addRecipe(name){await page.locator('#sales-recipe-search').fill(name);await page.locator('#sales-recipe-search').press('ArrowDown');await page.locator('#sales-recipe-search').press('Enter');}
 await addRecipe('Dish 01');await count('recipe-0').fill('2');await addRecipe('Dish 11');await count('recipe-10').fill('3');await addRecipe('Dish 23');await count('recipe-22').fill('7');
 await page.getByRole('button',{name:'Remove Dish 23 from sales',exact:true}).click();assert.equal(await count('recipe-22').count(),0);assert.equal(await count('recipe-0').inputValue(),'2');assert.match(await page.locator('#sales-preview').innerText(),/0\.005/);
 await addRecipe('Dish 23');await count('recipe-22').fill('1');await page.locator('#sales-recipe-search').fill('Dish 01');assert.equal(await page.locator('#sales-recipe-search-results [role=option]').count(),0);assert.equal(await region('sales-recipes').locator('input').count(),3);assert.equal(await count('recipe-0').inputValue(),'2');assert.match(await page.locator('#sales-selected').innerText(),/3 recipe/);assert.match(await page.locator('#sales-preview').innerText(),/0\.006/);
 await page.getByRole('button',{name:'Post sales & deduct ingredients',exact:true}).click();await page.getByText('Sales posted. Ingredient stock updated.',{exact:true}).waitFor();
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('kitchen-ledger-demo-v1')));assert.equal(saved.sales.at(-1).entries.length,3);assert.equal(saved.movements.at(-1).quantity,-.006);
 // Workspace switching clears searches, while editing and paging preserve drafts.
 await page.getByRole('button',{name:'+ Add recipe',exact:true}).click();await page.locator('#recipe-form input[name=name]').fill('Unsaved recipe');await search('recipes','Dish 02',1,'.recipe-card');assert.equal(await page.locator('#recipe-form input[name=name]').inputValue(),'Unsaved recipe');
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/pagination-mobile.png',fullPage:true});assert.deepEqual(errors,[]);
 console.log('Pagination browser passed: all requested lists, 10/10/3 pages, cross-page searches, zero results, chart/table alignment, source opening, whole-workspace export, preserved forms and selected-recipe sales deductions, mobile layout.');
}finally{await browser.close();server.close();}
