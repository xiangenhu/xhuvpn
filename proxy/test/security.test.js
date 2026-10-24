const {test}=require('node:test'),assert=require('node:assert/strict');
const http=require('node:http'),net=require('node:net');
const {once}=require('node:events');
const {publicIP,destination,basic,createHandlers}=require('../server');
test('private, metadata, IPv6 transition and mixed DNS destinations are denied and public addresses are pinned',async()=>{
 for(const address of ['127.0.0.1','10.0.0.1','192.168.1.1','169.254.169.254','100.100.100.200','::1','fe80::1','fc00::1','::ffff:127.0.0.1','2002:7f00:1::'])assert.equal(publicIP(address),false,address);
 assert.equal(publicIP('1.1.1.1'),true);
 await assert.rejects(destination('metadata.google.internal'));
 await assert.rejects(destination('example.com',async()=>[{address:'1.1.1.1',family:4},{address:'127.0.0.1',family:4}]));
 assert.deepEqual(await destination('example.com',async()=>[{address:'1.1.1.1',family:4}]),{address:'1.1.1.1',family:4});
 assert.equal(basic('Basic '+Buffer.from('a'.repeat(43)+':'+'b'.repeat(43)).toString('base64')).id,'a'.repeat(43));
 assert.equal(basic('Basic '+Buffer.from('short:wrong').toString('base64')),null);
});
async function fixture(t,options={}) {
 let permitted=true,lookups=0,connections=0;
 const handlers=createHandlers({gatewaySecret:'secret',heartbeatMs:10,
  validate:async()=>({ok:permitted,expires:Date.now()+10000}),lookup:async()=>{lookups++;return [{address:'127.0.0.1',family:4}];},
  connect:()=>{connections++;throw Error('Must not connect');},...options});
 const server=http.createServer(handlers.forward);server.on('connect',handlers.tunnel);server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>{server.closeAllConnections();server.close();});
 return {port:server.address().port,revoke:()=>{permitted=false;},lookups:()=>lookups,connections:()=>connections};
}
const auth='Basic '+Buffer.from('a'.repeat(43)+':'+'b'.repeat(43)).toString('base64');
async function connectRequest(port,target,authorization) {
 const socket=net.connect(port,'127.0.0.1');socket.on('error',()=>{});await once(socket,'connect');
 socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${authorization?'Proxy-Authorization: '+authorization+'\r\n':''}\r\n`);
 const [data]=await once(socket,'data');socket.destroy();return data.toString();
}
test('unauthenticated or revoked tunnels cannot trigger DNS/network access; internal targets and non-web ports stay blocked',async t=>{
 const f=await fixture(t);
 assert.match(await connectRequest(f.port,'example.com:443'),/407/);assert.equal(f.lookups(),0);
 f.revoke();assert.match(await connectRequest(f.port,'example.com:443',auth),/407/);assert.equal(f.lookups(),0);
 const g=await fixture(t);
 assert.match(await connectRequest(g.port,'example.com:22',auth),/403/);
 assert.match(await connectRequest(g.port,'example.com:443',auth),/502/);assert.equal(g.connections(),0);
 const health=await fetch('http://127.0.0.1:'+g.port+'/healthz');assert.equal(health.status,403);
});
test('an established public tunnel is closed when approval is revoked',async t=>{
 const echo=net.createServer(socket=>{socket.on('error',()=>{});socket.pipe(socket);});echo.listen(0,'127.0.0.1');await once(echo,'listening');
 t.after(()=>echo.close());let pinned;
 const f=await fixture(t,{lookup:async()=>[{address:'1.1.1.1',family:4}],connect:options=>{pinned=options.host;return net.connect(echo.address().port,'127.0.0.1');}});
 const socket=net.connect(f.port,'127.0.0.1');socket.on('error',()=>{});await once(socket,'connect');
 socket.write(`CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\nProxy-Authorization: ${auth}\r\n\r\n`);
 const [data]=await once(socket,'data');assert.match(data.toString(),/200 Connection Established/);assert.equal(pinned,'1.1.1.1');
 f.revoke();await once(socket,'close');assert.equal(socket.destroyed,true);
});
