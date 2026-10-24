const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const {createRequire}=require('node:module');
const {fakeBucket}=require('./fake-bucket');const {createOAuth}=require('../lib/oauth');
test('HTTP portal: sole admin invites friend, friend cannot administer, disable revokes live session and peers',async t=>{
 const bucket=fakeBucket();let identity='xiangenhu@gmail.com',lastState,sshFails=false;const scripts=[];
 const manualKey='p'.repeat(43)+'=';let manualIP='10.8.0.2';
 const staleKey='s'.repeat(43)+'=';
 await bucket.file('peers.json').save(JSON.stringify([{name:'old-profile',ip:'10.8.0.2',pubKey:staleKey,privKey:'old-private',owner:'xiangenhu@gmail.com'}]));
 const serverKey='yBq5ZCvbOkpnai8JrC+qYiLrLIeit99QWiwW4ZGKbG0=';
 await bucket.file('server-keys.json').save(JSON.stringify({pubKey:serverKey,privKey:'test-only'}));
 const fakeProxy=async(url,options)=>{const body=JSON.parse(options.body);if(url.endsWith('/start'))lastState=body.state;return {ok:true,json:async()=>url.endsWith('/start')?{url:'https://oauth.skoonline.org/authorize'}:{user:{email:identity,provider:'google',email_verified:true}}};};
 const env={APP_URL:'https://vpn.example',PROXY_CLIENT_ID:'test',PROXY_CLIENT_SECRET:'test-only',SESSION_ENCRYPTION_KEY:'ab'.repeat(32),GCS_BUCKET:'test',GCE_HOST:'test',SERVER_ENDPOINT:'vpn.example',LOCAL_SECRET_vpn_ssh_private_key:'test-only',EXTENSION_PROXY_ORIGIN:'https://proxy.example.test:8443',EXTENSION_GATEWAY_SECRET:'cd'.repeat(32)};
 const filename=path.resolve(__dirname,'../server.js'),realRequire=createRequire(filename),moduleObj={exports:{}};
 const sandboxRequire=name=>{
   if(name==='dotenv')return {config(){}};
   if(name==='@google-cloud/storage')return {Storage:class{bucket(){return bucket;}}};
   if(name==='@google-cloud/secret-manager')return {SecretManagerServiceClient:class{}};
   if(name==='node-ssh')return {NodeSSH:class{async connect(){} async execCommand(command){scripts.push(command);return {code:sshFails?1:0,stdout:command.includes('allowed-ips')?serverKey+'\n'+manualKey+'\t'+manualIP+'/32\n':'',stderr:''};}dispose(){}}};
   if(name==='./lib/oauth')return {createOAuth:args=>createOAuth({...args,env,fetchImpl:fakeProxy})};
   if(name==='./lib/extension-access')return {createExtensionAccess:args=>realRequire(name).createExtensionAccess({...args,fetchImpl:async()=>({ok:true})})};
   return realRequire(name);
 };
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{require:sandboxRequire,module:moduleObj,__dirname:path.dirname(filename),process:{env},Buffer,console,fetch},{filename});
 const server=moduleObj.exports.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());const base='http://127.0.0.1:'+server.address().port;
 async function call(url,{cookie,body,method}={}){return fetch(base+url,{method:method || (body===undefined?'GET':'POST'),redirect:'manual',headers:{...(cookie?{cookie}:{}),'Content-Type':'application/json','Origin':env.APP_URL,'X-VPN-Request':'1'},...(body===undefined?{}:{body:JSON.stringify(body)})});}
 async function login(email,invite){identity=email;const start=await call('/api/auth/oauth/start',invite?{body:{invite}}:{});assert.equal(start.status,invite?200:302);const pending=start.headers.getSetCookie()[0].split(';')[0];const callback=await call('/api/auth/oauth/callback?code=one-use&state='+lastState,{cookie:pending});return {response:callback,cookie:callback.headers.getSetCookie().find(c=>c.startsWith('__Host-vpn-session'))?.split(';')[0]};}
 const admin=await login('xiangenhu@gmail.com');assert.equal(admin.response.status,302);
 assert.equal((await call('/api/peers',{cookie:admin.cookie,body:{name:'before-consent'}})).status,403);
 assert.equal((await call('/api/consent',{cookie:admin.cookie,body:{version:'2026-10-23',accept:true}})).status,200);
 const invited=await call('/api/admin/invitations',{cookie:admin.cookie,body:{email:'friend@example.com'}});assert.equal(invited.status,201);const invitation=await invited.json();
 const stranger=await login('stranger@example.com');assert.equal(stranger.response.status,403);
 const friend=await login('friend@example.com',invitation.code);assert.equal(friend.response.status,302);
 assert.equal((await call('/api/consent',{cookie:friend.cookie,body:{version:'2026-10-23',accept:true}})).status,200);
 const me=await (await call('/api/me',{cookie:friend.cookie})).json();assert.equal(me.authType,'user');
 for(const [url,body] of [['/api/admin/invitations',{email:'other@example.com'}],['/api/admin/users/disable',{email:'xiangenhu@gmail.com'}],['/api/admin/reconcile',{}]])assert.equal((await call(url,{cookie:friend.cookie,body})).status,403);
 const device=await call('/api/peers',{cookie:friend.cookie,body:{name:'friend-phone'}});assert.equal(device.status,201);
 const profile=await device.json();assert.match(profile.config,/Address\s*= 10\.8\.0\.3\/32/);assert.match(profile.config,/MTU\s*= 1380/);
 assert.match(profile.config,/Endpoint\s*= test:51820/);assert.ok(!profile.config.includes('vpn.example'));
 const download=await call('/api/peers/friend-phone/config',{cookie:friend.cookie});
 assert.equal(download.status,200);assert.equal(download.headers.get('content-disposition'),'attachment; filename="friend-phone.conf"');
 assert.equal(download.headers.get('cache-control'),'no-store');assert.equal(await download.text(),profile.config);
 const listed=await (await call('/api/peers',{cookie:friend.cookie})).json();
 assert.equal(listed[0].hasConfig,true);assert.equal('privKey' in listed[0],false);
 // A granted member owns only their new registration, never the manual peer.
 assert.equal((await call('/api/peers/Existing-2/config',{cookie:friend.cookie})).status,403);
 const ownedByAdmin=await (await call('/api/peers',{cookie:admin.cookie})).json();
 assert.equal(ownedByAdmin.find(p=>p.pubKey===manualKey).owner,'xiangenhu@gmail.com');
 assert.equal(ownedByAdmin.find(p=>p.pubKey===manualKey).hasConfig,false);
 assert.equal(ownedByAdmin.find(p=>p.pubKey===staleKey).needsRepair,true);
 assert.equal(ownedByAdmin.find(p=>p.pubKey===staleKey).hasConfig,false);
 assert.equal((await call('/api/peers/old-profile/config',{cookie:admin.cookie})).status,409);
 manualIP='10.8.0.99';
 const conflicting=await call('/api/peers',{cookie:friend.cookie,body:{name:'conflict-test'}});
 assert.equal(conflicting.status,409);assert.match((await conflicting.json()).error,/Device address differs from saved records/);
 manualIP='10.8.0.2';
 assert.equal((await (await call('/api/peers',{cookie:friend.cookie})).json()).length,1);
 // The same member can approve and connect their own extension without admin.
 const verifier='v'.repeat(43),challenge=require('node:crypto').createHash('sha256').update(verifier).digest('base64url');
 const pair=await (await call('/api/extension/pair/start',{body:{challenge,browser:'Firefox'}})).json();
 assert.equal((await call('/api/extension/pair/complete',{cookie:friend.cookie,body:{deviceCode:pair.deviceCode,verifier}})).status,200);
 const extension=await (await call('/api/extension/pair/token',{body:{deviceCode:pair.deviceCode,verifier}})).json();
 assert.equal(extension.status,'connected');
 const connections=await (await call('/api/extension/sessions',{cookie:friend.cookie})).json();assert.equal(connections.length,1);
 assert.equal((await call('/api/admin/import-devices',{cookie:friend.cookie,body:{}})).status,403);
 assert.equal((await call('/api/admin/import-devices',{cookie:admin.cookie,body:{}})).status,200);
 const connection=await call('/api/peers/friend-phone/connection',{cookie:friend.cookie});assert.equal((await connection.json()).recentHandshake,false);
 assert.equal((await call('/api/peers',{cookie:admin.cookie,body:{name:'owner-phone'}})).status,201);
 const friendsPeers=await (await call('/api/peers',{cookie:friend.cookie})).json();assert.equal(friendsPeers.length,1);assert.equal(friendsPeers[0].name,'friend-phone');assert.equal((await call('/api/peers/owner-phone/config',{cookie:friend.cookie})).status,403);
 for(let n=0;n<3;n++) {
  const additional=await call('/api/peers',{cookie:friend.cookie,body:{name:'friend-extra-'+n,owner:'xiangenhu@gmail.com'}});
  assert.equal(additional.status,201);
 }
 const allFriendDevices=await (await call('/api/peers',{cookie:friend.cookie})).json();
 assert.equal(allFriendDevices.length,4);assert.ok(allFriendDevices.every(p=>p.owner==='friend@example.com'));
 sshFails=true;
 const disabled=await call('/api/admin/users/disable',{cookie:admin.cookie,body:{email:'friend@example.com'}});assert.equal(disabled.status,503);assert.equal((await disabled.json()).needsReconcile,true);
 assert.equal((await call('/api/me',{cookie:friend.cookie})).status,403);
 const all=await (await call('/api/peers',{cookie:admin.cookie})).json();assert.equal(all.length,3);assert.ok(all.some(p=>p.name==='owner-phone'));assert.ok(all.some(p=>p.pubKey===manualKey));
 sshFails=false;assert.equal((await call('/api/admin/reconcile',{cookie:admin.cookie,body:{}})).status,200);
 assert.equal((await call('/api/admin/users/disable',{cookie:admin.cookie,body:{email:'xiangenhu@gmail.com'}})).status,400);
 assert.ok(scripts.some(s=>s.includes('base64 -d | sudo -n bash')));
 for(const command of scripts.filter(s=>s.includes('base64 -d | sudo -n bash'))) {
   const script=Buffer.from(command.split("'")[3],'base64').toString();
   const config=Buffer.from(script.match(/printf '%s' '([^']+)' \| base64 -d > "\$file"/)[1],'base64').toString();
   assert.match(config,new RegExp(manualKey.replace(/[+]/g,'\\+')));assert.ok(!config.includes(staleKey));
   assert.equal(require('node:child_process').spawnSync('bash',['-n'],{input:script}).status,0);
 }
});
