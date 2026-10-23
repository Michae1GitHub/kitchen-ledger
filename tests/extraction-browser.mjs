import {chromium} from '@playwright/test';
import {server} from '../server.mjs';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
await new Promise(r=>server.listen(4175,'127.0.0.1',r));
const browser=await chromium.launch({...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{}),headless:true});
const page=await browser.newPage({viewport:{width:900,height:700}});
page.setDefaultTimeout(120000);
try{
 await mkdir('test-results',{recursive:true});
 await page.setContent('<main style="font:28px Arial;padding:40px;background:white;color:black"><h1>HARVEST FOODSERVICE</h1><p>Invoice: OCR-12345</p><p>Date: 2026-10-08</p><p>Canned tomatoes 2 cases $30.00 $60.00</p><p>Subtotal: $60.00</p><p>Tax: $0.00</p><p>Total: $60.00</p></main>');
 await page.screenshot({path:'test-results/ocr-invoice.png'});await page.pdf({path:'test-results/text-invoice.pdf'});
 await page.setContent('<body style="margin:0"><img style="display:block;width:100%" src="data:image/png;base64,'+(await readFile('test-results/ocr-invoice.png')).toString('base64')+'"></body>');await page.pdf({path:'test-results/scanned-invoice.pdf'});
 await page.goto('http://127.0.0.1:4175');await page.getByRole('button',{name:'+ Upload invoice',exact:true}).click();
 await page.locator('#invoice-file').setInputFiles('test-results/ocr-invoice.png');await page.getByRole('button',{name:'Extract & open review'}).click();
 await page.locator('#invoice-form').waitFor();assert.equal(await page.locator('input[name="number"]').inputValue(),'OCR-12345');
 assert.ok((await page.locator('.receipt').textContent()).includes('60.00'));await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByRole('button',{name:'← All invoices'}).waitFor();
 await page.reload();await page.getByRole('button',{name:'Invoices',exact:true}).click();await page.locator('tr').filter({hasText:'OCR-12345'}).getByRole('button',{name:'Review'}).click();await page.locator('img[alt="Original uploaded invoice"]').waitFor();
 await page.getByRole('button',{name:'← All invoices'}).click();await page.getByRole('button',{name:'+ Upload invoice',exact:true}).click();await page.locator('#invoice-file').setInputFiles('test-results/text-invoice.pdf');await page.getByRole('button',{name:'Extract & open review'}).click();await page.locator('#invoice-form').waitFor();assert.equal(await page.locator('input[name="number"]').inputValue(),'OCR-12345');
 await page.getByRole('button',{name:'← All invoices'}).click();await page.getByRole('button',{name:'+ Upload invoice',exact:true}).click();await page.locator('#invoice-file').setInputFiles('test-results/scanned-invoice.pdf');await page.getByRole('button',{name:'Extract & open review'}).click();await page.locator('#invoice-form').waitFor();assert.equal(await page.locator('input[name=number]').inputValue(),'OCR-12345');
 console.log('Image OCR, digital PDF extraction, scanned PDF OCR, and original-file persistence passed.');
}finally{await browser.close();server.close();}
