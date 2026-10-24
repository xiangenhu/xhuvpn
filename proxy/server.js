'use strict';
const https=require('node:https'),http=require('node:http'),net=require('node:net');
const dns=require('node:dns').promises,fs=require('node:fs'),crypto=require('node:crypto');
const ipaddr=require('ipaddr.js');
function publicIP(address) {
  try {return ipaddr.process(address).range()==='unicast';}catch{return false;}
}
async function destination(host,lookup=dns.lookup) {
  host=host.replace(/^\[|\]$/g,'').toLowerCase().replace(/\.$/,'');
  if(!host || /[\s%@/\\]/.test(host) || /(^|\.)(localhost|local|internal|invalid)$/.test(host))throw Error('Destination denied');
  const addresses=net.isIP(host)?[{address:host,family:net.isIP(host)}]:await lookup(host,{all:true,verbatim:true});
  if(!addresses.length || !addresses.every(a=>publicIP(a.address)))throw Error('Destination denied');
  return addresses[0]; // Pin the validated address: never resolve again while connecting.
}
function basic(value) {
  if(typeof value!=='string' || value.length>256 || !/^Basic [A-Za-z0-9+/=]+$/i.test(value))return null;
  const match=/^([A-Za-z0-9_-]{43}):([A-Za-z0-9_-]{43})$/.exec(Buffer.from(value.slice(6),'base64').toString('utf8'));
  return match?{id:match[1],password:match[2]}:null;
}
function safeEqual(a,b) {return typeof a==='string' && Buffer.byteLength(a)===Buffer.byteLength(b) && crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));}
function createHandlers({validate,gatewaySecret,portalHost='vpn.skoonline.org',proxyHost,lookup=dns.lookup,connect=net.connect,request=http.request,heartbeatMs=30000}) {
  let active=0;const counts=new Map();
  const checkHost=host=>{if([portalHost,proxyHost].filter(Boolean).includes(host.toLowerCase().replace(/\.$/,'')))throw Error('Destination denied');};
  async function authorize(req) {
    const credentials=basic(req.headers['proxy-authorization']);
    if(!credentials)return null;
    const result=await validate(credentials);
    return result?.ok && result.expires>Date.now()?{...credentials,expires:result.expires}:null;
  }
  function track(credentials,stream) {
    if(active>=256 || (counts.get(credentials.id)||0)>=48)throw Error('Busy');
    active++;counts.set(credentials.id,(counts.get(credentials.id)||0)+1);
    let checking=false;
    const heartbeat=setInterval(async()=>{
      if(checking)return;checking=true;
      try {const result=await validate(credentials);if(!result?.ok || result.expires<=Date.now())stream.destroy();}
      catch {stream.destroy();}finally{checking=false;}
    },heartbeatMs);
    const expiry=setTimeout(()=>stream.destroy(),Math.min(credentials.expires-Date.now(),8*3600000));
    const cleanup=()=>{clearInterval(heartbeat);clearTimeout(expiry);active--;counts.set(credentials.id,Math.max(0,(counts.get(credentials.id)||1)-1));if(!counts.get(credentials.id))counts.delete(credentials.id);};
    stream.once('close',cleanup);
    stream.setTimeout(60000,()=>stream.destroy());
  }
  async function tunnel(req,socket,head) {
    socket.on('error',()=>{});
    let upstream;
    const fail=(status,label)=>{if(!socket.destroyed)socket.end(`HTTP/1.1 ${status} ${label}\r\nConnection: close\r\n${status===407?'Proxy-Authenticate: Basic realm="Xiangen Research Network"\r\n':''}\r\n`);};
    try {
      const credentials=await authorize(req);if(!credentials)return fail(407,'Proxy Authentication Required');
      if(!/^(\[[0-9a-f:]+\]|[a-z0-9.-]+):443$/i.test(req.url))return fail(403,'Forbidden');
      const url=new URL('https://'+req.url);checkHost(url.hostname);
      const address=await destination(url.hostname,lookup);
      if(socket.destroyed)return;
      track(credentials,socket);
      upstream=connect({host:address.address,port:443,family:address.family});
      upstream.setTimeout(15000,()=>upstream.destroy());
      upstream.once('error',()=>{socket.destroy();});
      socket.once('close',()=>upstream.destroy());
      upstream.once('connect',()=>{
        if(socket.destroyed)return upstream.destroy();
        upstream.setTimeout(60000,()=>upstream.destroy());
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if(head.length)upstream.write(head);
        upstream.pipe(socket);socket.pipe(upstream);
      });
      upstream.once('close',()=>socket.destroy());
    }catch {if(upstream)upstream.destroy();fail(502,'Proxy Unavailable');}
  }
  async function forward(req,res) {
    if(req.url==='/healthz') {
      if(!safeEqual(req.headers.authorization,'Bearer '+gatewaySecret))return res.writeHead(403).end();
      return res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end('{"ok":true}');
    }
    let upstream;
    try {
      const credentials=await authorize(req);
      if(!credentials)return res.writeHead(407,{'Proxy-Authenticate':'Basic realm="Xiangen Research Network"','Connection':'close'}).end();
      const url=new URL(req.url);
      if(url.protocol!=='http:' || url.username || url.password || (url.port && url.port!=='80') || url.hash)return res.writeHead(403).end();
      checkHost(url.hostname);const address=await destination(url.hostname,lookup);
      const headers={...req.headers,host:url.host,connection:'close'};
      const nominated=String(req.headers.connection || '').split(',').map(s=>s.trim().toLowerCase());
      for(const h of ['proxy-authorization','proxy-connection','connection','keep-alive','te','trailer','transfer-encoding','upgrade',...nominated])delete headers[h];
      headers.connection='close';
      track(credentials,res.socket);
      upstream=request({hostname:address.address,family:address.family,port:80,path:url.pathname+url.search,method:req.method,headers,agent:false},incoming=>{
        const outgoing={...incoming.headers};delete outgoing['proxy-authenticate'];delete outgoing['proxy-authorization'];
        res.writeHead(incoming.statusCode,outgoing);incoming.pipe(res);
      });
      upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});
      upstream.setTimeout(15000,()=>upstream.destroy());
      res.once('close',()=>upstream.destroy());req.pipe(upstream);
    }catch {if(upstream)upstream.destroy();if(!res.headersSent)res.writeHead(502);res.end();}
  }
  return {tunnel,forward};
}
function main(env=process.env) {
  const origin=new URL(env.PORTAL_ORIGIN || 'https://vpn.skoonline.org');
  if(origin.protocol!=='https:' || origin.origin!==(env.PORTAL_ORIGIN || origin.origin) || !/^[a-f0-9]{64}$/i.test(env.EXTENSION_GATEWAY_SECRET || ''))throw Error('Configure the HTTPS portal origin and a private gateway secret');
  const validate=async credentials=>{
    const response=await fetch(origin.origin+'/api/extension/verify',{method:'POST',redirect:'error',signal:AbortSignal.timeout(7000),headers:{'Content-Type':'application/json',Authorization:'Bearer '+env.EXTENSION_GATEWAY_SECRET},body:JSON.stringify({id:credentials.id,password:credentials.password})});
    if(!response.ok)return {ok:false};return response.json();
  };
  const handlers=createHandlers({validate,gatewaySecret:env.EXTENSION_GATEWAY_SECRET,portalHost:origin.hostname,proxyHost:env.PROXY_PUBLIC_HOST});
  const server=https.createServer({cert:fs.readFileSync(env.TLS_CERT_FILE || '/certs/fullchain.pem'),key:fs.readFileSync(env.TLS_KEY_FILE || '/certs/privkey.pem'),minVersion:'TLSv1.2',maxHeaderSize:16384},handlers.forward);
  server.on('connect',handlers.tunnel);server.on('upgrade',(req,socket)=>socket.destroy());
  server.on('clientError',(err,socket)=>socket.destroy());server.headersTimeout=15000;server.requestTimeout=300000;server.maxConnections=256;
  server.listen(Number(env.PORT || 8443),'0.0.0.0',()=>console.log('Authenticated research proxy listening'));
  const shutdown=()=>{server.close();server.closeAllConnections();setTimeout(()=>process.exit(0),1000).unref();};
  process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
  return server;
}
if(require.main===module)try {main();}catch {console.error('Proxy startup failed: check gateway secret, TLS certificate paths and permissions.');process.exitCode=1;}
module.exports={publicIP,destination,basic,createHandlers,main};
