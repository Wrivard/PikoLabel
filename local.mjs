// Local testing only. Vercel uses the individual /api/*.js functions, not this server.
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {route} from './lib/api.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
try{const env=fs.readFileSync(path.join(root,'.env'),'utf8');for(const line of env.split('\n')){const m=line.match(/^\s*([A-Z][A-Z0-9_]*)=(.*)\s*$/);if(m&&process.env[m[1]]===undefined)process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,'').trim();}}catch{}
const actions=new Map([['/api/bootstrap','bootstrap'],['/api/login','login'],['/api/logout','logout'],['/api/orders','orders'],['/api/books/list','books-list'],['/api/books/add','books-add'],['/api/books/upload','books-upload'],['/api/books/export','books-export'],['/api/books/document','books-document'],['/api/settings','settings'],['/api/disconnect','disconnect'],['/api/oauth/start','oauth-start'],['/api/oauth/callback','oauth-callback'],['/api/documents/packing','packing'],['/api/documents/labels','labels']]);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{
  const p=new URL(req.url,'http://localhost').pathname;
  if(actions.has(p))return route(req,res,actions.get(p));
  const name=p==='/'?'index.html':p.slice(1);
  if(!['index.html','app.js','style.css','favicon.svg','books.js','books.css'].includes(name)){res.writeHead(404);return res.end('Not found');}
  const f=path.join(root,'public',name);res.writeHead(200,{'content-type':types[path.extname(f)],'cache-control':'no-store'});fs.createReadStream(f).pipe(res);
});
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Piko Label Printer dev server: http://localhost:'+(process.env.PORT||3000)));
