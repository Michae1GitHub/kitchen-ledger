import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {parseExtraction} from '../web/extraction.js';
import {seed} from '../web/domain.js';
await mkdir('test-results',{recursive:true});
const baselineSource=await readFile('tests/fixtures/baseline-extraction.js','utf8');
await writeFile('test-results/baseline-extraction.mjs',baselineSource);await writeFile('test-results/domain.js',await readFile('web/domain.js'));
const baseline=await import('../test-results/baseline-extraction.mjs');
const fixtures=JSON.parse(await readFile('tests/fixtures/invoice-layouts.json','utf8'));const scores=[];
for(const f of fixtures){const old=baseline.parseExtraction({text:f.text},seed(),{name:'fixture.txt'}),current=parseExtraction({text:f.text},seed(),{name:'fixture.txt'});let total=0,previous=0,revised=0;for(const [key,value]of Object.entries(f.expected)){if(key==='warning')continue;if(key==='items'){total++;previous+=old.items.length===value.length;revised+=current.items.length===value.length;value.forEach((line,k)=>{for(const [field,v]of Object.entries(line)){total++;previous+=old.items[k]?.[field]===v;revised+=current.items[k]?.[field]===v;}});}else{total++;previous+=old[key]===value;revised+=current[key]===value;}}scores.push({layout:f.name,total,previous,revised});}
const report={scope:'Six synthetic text-layout fixtures; not a production accuracy estimate',scores,totals:scores.reduce((a,s)=>({checks:a.checks+s.total,previous:a.previous+s.previous,revised:a.revised+s.revised}),{checks:0,previous:0,revised:0})};await writeFile('test-results/extraction-benchmark.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
