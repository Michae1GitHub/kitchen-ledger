import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {handleAI} from './worker/ai-handler.js';
const root=path.resolve('web');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
export const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,`http://${req.headers.host}`),pathname=decodeURIComponent(url.pathname);if(['/api/invoice-chat','/api/ai-status'].includes(pathname)){const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>6000000){res.writeHead(413);res.end('Request too large');return;}chunks.push(chunk);}const response=await handleAI(new Request(url,{method:req.method,headers:req.headers,...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})}),process.env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;}const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+path.sep)||pathname.startsWith('/server/')||pathname.startsWith('/.openai/')){res.writeHead(403);res.end();return;}const data=await readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);}catch{res.writeHead(404);res.end('Not found');}});
if(process.argv[1]?.endsWith('server.mjs'))server.listen(4173,'127.0.0.1',()=>console.log('Kitchen Ledger: http://127.0.0.1:4173'));
