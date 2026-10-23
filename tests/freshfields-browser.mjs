import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {server} from '../server.mjs';
await new Promise(r=>server.listen(4177,'127.0.0.1',r));
const browser=await chromium.launch({...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{}),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(120000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:4177');await page.getByRole('button',{name:'+ Upload invoice',exact:true}).click();
 // First reproduce the exact OCR output supplied by the user.
 const text=await readFile('tests/fixtures/freshfields-ocr.txt');
 await page.locator('#invoice-file').setInputFiles({name:'freshfields-ocr.txt',mimeType:'text/plain',buffer:text});await page.getByRole('button',{name:'Extract & open review'}).click();await page.locator('#invoice-form').waitFor();
 for(const [name,value]of Object.entries({number:'FFS-10428',date:'2025-04-14',dueDate:'2025-05-14',purchaseOrderReference:'BV-7821',extractedSupplierName:'FreshFields Food Supply',tax:'30.32',charges:'20',subtotal:'391.3',total:'441.62'}))assert.equal(await page.locator(`input[name="${name}"]`).inputValue(),value,name);
 assert.equal(await page.locator('.linecard').count(),8);assert.equal(await page.locator('input[name="line.2.quantity"]').inputValue(),'3');
 await page.getByRole('button',{name:'+ Add supplier',exact:true}).click();assert.equal(await page.locator('dialog input[name=name]').inputValue(),'FreshFields Food Supply');assert.equal(await page.locator('dialog input[name=email]').inputValue(),'orders@freshfieldsfoods.com');await page.locator('dialog').getByRole('button',{name:'Add supplier',exact:true}).click();await page.locator('dialog').waitFor({state:'detached'});assert.ok(await page.locator('select[name=supplierId]').inputValue());
 await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByText('Draft saved.',{exact:true}).waitFor();await page.reload();await page.getByRole('button',{name:'Invoices',exact:true}).click();await page.locator('tr').filter({hasText:'FFS-10428'}).getByRole('button',{name:'Review',exact:true}).click();assert.equal(await page.locator('.linecard').count(),8);assert.equal(await page.locator('input[name=tax]').inputValue(),'30.32');
 // Then run OCR on the actual attached image, when its path is provided.
 if(process.argv[2]){await page.getByRole('button',{name:'← All invoices'}).click();await page.getByRole('button',{name:'+ Upload invoice',exact:true}).click();await page.locator('#invoice-file').setInputFiles(process.argv[2]);await page.getByRole('button',{name:'Extract & open review'}).click();await page.locator('#invoice-form').waitFor();await mkdir('test-results',{recursive:true});await writeFile('test-results/freshfields-reconstructed.txt',await page.locator('.receipt').textContent());assert.equal(await page.locator('input[name=number]').inputValue(),'FFS-10428');assert.equal(await page.locator('.linecard').count(),8);assert.equal(await page.locator('input[name=date]').inputValue(),'2025-04-14');assert.equal(await page.locator('input[name=tax]').inputValue(),'30.32');assert.equal(await page.locator('input[name=charges]').inputValue(),'20');await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/freshfields-review.png',fullPage:true});}
 assert.deepEqual(errors,[]);console.log('FreshFields regression passed: details, all eight lines, tax, delivery fee, supplier creation and saved-draft persistence.');
}finally{await browser.close();server.close();}
