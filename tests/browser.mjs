import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {server} from '../server.mjs';
await new Promise(resolve=>server.listen(4174,'127.0.0.1',resolve));
const browser=await chromium.launch({...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{}),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:4174');
 await page.getByRole('button',{name:'Invoices',exact:true}).click();
 await page.getByRole('button',{name:'Review',exact:true}).first().click();
 await page.getByRole('button',{name:'Approve invoice',exact:true}).click();
 await page.getByRole('button',{name:'Confirm delivery & update stock'}).waitFor();
 await page.getByRole('button',{name:'Confirm delivery & update stock'}).click();
 await page.getByText('All stock items have been received.').waitFor();
 await page.getByRole('button',{name:'Inventory',exact:true}).click();
 await page.getByRole('cell',{name:'9.00 kg',exact:true}).waitFor();
 // First row reviewed is the produce invoice: opening 3 + 6 = 9 kg.
 await page.reload();await page.getByRole('button',{name:'Inventory',exact:true}).click();await page.getByRole('cell',{name:'9.00 kg',exact:true}).waitFor();
 await page.getByRole('button',{name:'Invoices',exact:true}).click();await page.getByRole('button',{name:'Review',exact:true}).click();
 await page.locator('input[name="total"]').fill('1');await page.getByRole('button',{name:'Approve invoice',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Confirm delivery & update stock'}).count(),0);
 await page.getByRole('button',{name:'Calculate subtotal and total'}).click();await page.getByRole('button',{name:'Approve invoice',exact:true}).click();await page.getByRole('button',{name:'Confirm delivery & update stock'}).waitFor();
 await page.locator('input[name="l1"]').fill('10');await page.locator('input[name="l2"]').fill('0');await page.locator('input[name="l3"]').fill('0');await page.getByRole('button',{name:'Confirm delivery & update stock'}).click();await page.getByText('10 received / 30 kg').waitFor();
 await page.getByRole('button',{name:'Inventory',exact:true}).click();await page.getByRole('cell',{name:'22.00 kg',exact:true}).waitFor();
 await page.getByRole('button',{name:'Reports',exact:true}).click();await page.getByText('$361.80',{exact:true}).first().waitFor();
 await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Overview',exact:true}).click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'test-results/mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('Browser workflow passed: approval, validation, partial receipt, stock, persistence, reports, mobile layout.');
}finally{await browser.close();server.close();}
