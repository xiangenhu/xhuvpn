const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {webcrypto}=require('node:crypto');
const core=require('../extension/core');
const source=fs.readFileSync(require.resolve('../extension/background.js'),'utf8');
const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn);}});
async function fixture(firefox) {
 let stored={},owned=false,settings,privacyOwned=false,privacyValue,approved=false,revoked=false,conflict=false;
 const opened=[];
 const api={storage:{local:{get:async()=>structuredClone(stored),set:async value=>{stored=structuredClone(value);}}},
  action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},alarms:{create:async()=>{},onAlarm:event()},
  tabs:{create:async value=>{opened.push(value);return {id:7};}},runtime:{id:'unit-extension',onMessage:event(),onStartup:event(),onInstalled:event()},
  proxy:{settings:{get:async()=>({levelOfControl:conflict?'controlled_by_other_extensions':owned?'controlled_by_this_extension':'controllable_by_this_extension'}),set:async value=>{owned=true;settings=value;},clear:async()=>{owned=false;settings=null;}},onProxyError:event()},
  privacy:{network:{}},webRequest:{onAuthRequired:event(),onCompleted:event(),onErrorOccurred:event()}};
 const privacy={set:async value=>{privacyOwned=true;privacyValue=value.value;},get:async()=>({levelOfControl:privacyOwned?'controlled_by_this_extension':'controllable_by_this_extension'}),clear:async()=>{privacyOwned=false;privacyValue=undefined;}};
 if(firefox){api.proxy.onRequest=event();api.proxy.onError=event();api.privacy.network.peerConnectionEnabled=privacy;}
 else api.privacy.network.webRTCIPHandlingPolicy=privacy;
 const result={status:'connected',id:'i'.repeat(43),password:'p'.repeat(43),expires:Date.now()+3600000,proxy:{host:'proxy.example.test',port:8443,scheme:'https'}};
 const context={ResearchProxy:core,crypto:webcrypto,TextEncoder,URL,btoa,AbortSignal,console,
  ...(firefox?{browser:api}:{chrome:api,importScripts:()=>{}}),
  fetch:async(url,options)=>{
    const path=new URL(url).pathname,body=JSON.parse(options.body || '{}');let data;
    if(path.endsWith('/pair/start')) {assert.match(body.challenge,/^[A-Za-z0-9_-]{43}$/);data={deviceCode:'d'.repeat(43),userCode:'ABCD-EF01-2345',expires:Date.now()+600000};}
    else if(path.endsWith('/pair/token')) {assert.match(body.verifier,/^[A-Za-z0-9_-]{43}$/);data=approved?result:{status:'pending'};}
    else if(path.endsWith('/disconnect')){revoked=true;data={revoked:true};}
    else throw Error('Unexpected API request');
    return {ok:true,json:async()=>data};
  }};
 vm.runInNewContext(source,context);
 const send=(action,sender={id:api.runtime.id})=>new Promise(resolve=>{api.runtime.onMessage.listeners[0]({action},sender,resolve);});
 return {api,opened,send,approve:()=>{approved=true;},conflict:()=>{conflict=true;},stored:()=>stored,settings:()=>settings,privacy:()=>privacyValue,revoked:()=>revoked,session:result};
}
for(const firefox of [false,true])test(`${firefox?'Firefox':'Chromium'} controller pairs, applies proxy, limits auth and restores settings on disconnect`,async()=>{
 const f=await fixture(firefox);
 assert.equal((await f.send('connect')).mode,'pairing');assert.equal(f.opened.length,1);assert.ok(f.opened[0].url.endsWith('?extension=connect'));
 assert.equal((await f.send('status')).mode,'pairing');f.approve();assert.equal((await f.send('status')).mode,'connected');
 assert.equal(f.privacy(),firefox?false:'disable_non_proxied_udp');
 if(firefox){
  const route=f.api.proxy.onRequest.listeners[0];assert.equal((await route({url:'https://example.com/'})).type,'https');
  assert.equal((await route({url:'https://vpn.skoonline.org/'})).type,'direct');
 }else {assert.equal(f.settings().value.rules.singleProxy.scheme,'https');assert.ok(!f.settings().value.rules.bypassList.includes('*'));}
 const challenge={isProxy:true,requestId:'request-1',challenger:{host:f.session.proxy.host,port:8443}};
 const auth=details=>firefox?f.api.webRequest.onAuthRequired.listeners[0](details):new Promise(resolve=>f.api.webRequest.onAuthRequired.listeners[0](details,resolve));
 assert.equal((await auth({...challenge,isProxy:false})).authCredentials,undefined);
 assert.equal((await auth(challenge)).authCredentials.password,f.session.password);
 assert.equal((await auth(challenge)).cancel,true);
 assert.equal((await f.send('disconnect')).mode,'off');assert.equal(f.revoked(),true);assert.equal(f.stored().active,null);assert.equal(f.privacy(),undefined);
 if(firefox)assert.equal(await f.api.proxy.onRequest.listeners[0]({url:'https://example.com/'}),undefined);
 else assert.equal(f.settings(),null);
});
test('a conflicting proxy extension rolls back a new grant instead of reporting connected',async()=>{
 const f=await fixture(false);await f.send('connect');f.approve();f.conflict();
 const status=await f.send('status');assert.equal(status.mode,'off');assert.match(status.problem,/Another extension/);assert.equal(f.revoked(),true);
});

test('only the extension-opened portal tab can obtain its sign-in proof and finish automatically',async()=>{
 const f=await fixture(false);await f.send('connect');
 for(const sender of [{id:f.api.runtime.id,tab:{id:8},frameId:0,url:'https://vpn.skoonline.org/'},{id:f.api.runtime.id,tab:{id:7},frameId:1,url:'https://vpn.skoonline.org/'},{id:f.api.runtime.id,tab:{id:7},frameId:0,url:'https://evil.example/'}]) {
  const result=await f.send('signInRequest',sender);assert.equal(result.verifier,undefined);assert.equal(result.deviceCode,undefined);
 }
 const sender={id:f.api.runtime.id,tab:{id:7},frameId:0,url:'https://vpn.skoonline.org/'};
 const request=await f.send('signInRequest',sender);assert.match(request.verifier,/^[A-Za-z0-9_-]{43}$/);
 f.approve();assert.equal((await f.send('finishSignIn',sender)).mode,'connected');
 assert.equal((await f.send('signInRequest',sender)).verifier,undefined);
 assert.equal((await f.send('disconnect',sender)).mode,'connected');
});
