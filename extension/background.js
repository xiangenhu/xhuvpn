'use strict';
if(typeof importScripts==='function')importScripts('core.js');
const ext=typeof browser!=='undefined'?browser:chrome;
const firefox=typeof browser!=='undefined' && Boolean(browser.proxy?.onRequest);
const PORTAL='https://vpn.skoonline.org';
let state={},problem='',queue=Promise.resolve();
const initialized=ext.storage.local.get(['active','pair']).then(value=>{state=value;});
const attempts=new Set();
const serialize=fn=>{const result=queue.then(()=>initialized).then(fn);queue=result.catch(()=>{});return result;};
async function save() {
  await ext.storage.local.set({active:state.active || null,pair:state.pair || null});
  await ext.action.setBadgeText({text:state.active?'ON':state.pair?'…':''});
  await ext.action.setBadgeBackgroundColor({color:state.active?'#087e75':'#56657a'});
}
async function api(path,body) {
  const response=await fetch(PORTAL+'/api/extension/'+path,{method:body===undefined?'GET':'POST',credentials:'omit',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});
  let data;try {data=await response.json();}catch {throw Error('The research network is temporarily unavailable.');}
  if(!response.ok)throw Error(data.error || 'Connection request failed.');return data;
}
async function policy(enable) {
  if(!firefox) {
    const current=await ext.proxy.settings.get({incognito:false});
    if(enable) {
      if(!['controllable_by_this_extension','controlled_by_this_extension'].includes(current.levelOfControl))throw Error('Another extension or your administrator controls this browser’s proxy.');
      const p=state.active.proxy;
      await ext.proxy.settings.set({scope:'regular',value:{mode:'fixed_servers',rules:{singleProxy:{scheme:'https',host:p.host,port:p.port},bypassList:[new URL(PORTAL).hostname,p.host,'<-loopback>']}}});
    }else if(current.levelOfControl==='controlled_by_this_extension')await ext.proxy.settings.clear({scope:'regular'});
  }else if(enable) {
    const current=await ext.proxy.settings.get({});
    if(current.levelOfControl==='controlled_by_other_extensions' || current.levelOfControl==='not_controllable')throw Error('Another extension or your administrator controls this browser’s proxy.');
  }
  // Firefox's per-request proxy does not reliably constrain WebRTC UDP; disable
  // peer connections while on, then restore the underlying user setting on off.
  const rtc=firefox?ext.privacy?.network?.peerConnectionEnabled:ext.privacy?.network?.webRTCIPHandlingPolicy;
  if(!rtc){if(enable)throw Error('This browser cannot apply the required WebRTC connection policy.');return;}
  if(enable)await rtc.set({value:firefox?false:'disable_non_proxied_udp',...(firefox?{}:{scope:'regular'})});
  else {try {const current=await rtc.get({});if(current.levelOfControl==='controlled_by_this_extension')await rtc.clear(firefox?{}:{scope:'regular'});}catch { /* A leftover restrictive privacy setting does not keep the proxy connected. */ }}
}
async function poll() {
  if(!state.pair)return;
  if(state.pair.expires<=Date.now()){state.pair=null;problem='Connection approval expired. Click Connect again.';await save();return;}
  const result=await api('pair/token',{deviceCode:state.pair.deviceCode,verifier:state.pair.verifier});
  if(result.status==='pending')return;
  if(!ResearchProxy.validSession(result))throw Error('The portal returned invalid proxy settings.');
  state.active=result;state.pair=null;
  // Persist before installing settings: service-worker restarts retain authentication.
  await save();
  try {await policy(true);problem='';}
  catch(e){
    try {await api('disconnect',{id:result.id,password:result.password});}catch {}
    await policy(false).catch(()=>{});state.active=null;await save();throw e;
  }
}
async function start() {
  if(state.active)throw Error('Disconnect this connection before starting a new one.');
  if(state.pair){await ext.tabs.create({url:PORTAL+'/#extension='+state.pair.userCode});return;}
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  const encode=buffer=>btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const verifier=encode(bytes),challenge=encode(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
  const browserName=firefox?'Firefox':'Chrome / Edge / Brave / Opera';
  const result=await api('pair/start',{challenge,browser:browserName});
  if(!/^[A-Za-z0-9_-]{43}$/.test(result.deviceCode) || !/^[A-F0-9]{4}(-[A-F0-9]{4}){2}$/.test(result.userCode) || !Number.isFinite(result.expires))throw Error('Invalid connection request.');
  state.pair={...result,verifier};problem='';await save();
  await ext.alarms.create('research-connection',{periodInMinutes:0.5});
  await ext.tabs.create({url:PORTAL+'/#extension='+result.userCode});
}
async function disconnect() {
  const active=state.active;let revoked=true;
  // Clear only settings owned by this extension, restoring the browser's prior state.
  await policy(false);
  state.active=null;state.pair=null;attempts.clear();await save();
  if(active)try {await api('disconnect',{id:active.id,password:active.password});}catch {revoked=false;}
  problem=revoked?'':'Disconnected locally. The server connection will expire; it could not be revoked while offline.';
}
function status() {return {mode:state.active?(state.active.expires>Date.now()?'connected':'expired'):state.pair?'pairing':'off',expires:state.active?.expires,userCode:state.pair?.userCode,problem};}
ext.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender.id!==ext.runtime.id)return;
  serialize(async()=>{
    if(message?.action==='connect')await start();
    else if(message?.action==='disconnect')await disconnect();
    else if(message?.action==='status')await poll();
    else throw Error('Unknown request.');
    return status();
  }).then(reply,error=>{problem=error.message;reply({...status(),problem});});
  return true;
});
ext.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='research-connection')void serialize(poll).catch(()=>{});});
const auth=async details=>{
  await initialized;
  const result=ResearchProxy.credentials(details,state.active,attempts.has(details.requestId));
  if(result.authCredentials)attempts.add(details.requestId);return result;
};
if(firefox) {
  ext.webRequest.onAuthRequired.addListener(auth,{urls:['<all_urls>']},['blocking']);
  ext.proxy.onRequest.addListener(async details=>{
    await initialized;if(!state.active)return;
    const host=new URL(details.url).hostname;
    if(ResearchProxy.bypass(host,new URL(PORTAL).hostname,state.active.proxy.host))return {type:'direct'};
    return {type:'https',host:state.active.proxy.host,port:state.active.proxy.port};
  },{urls:['<all_urls>']});
  ext.proxy.onError.addListener(()=>{problem='The proxy connection failed. Retry or disconnect to use your normal connection.';});
}else {
  ext.webRequest.onAuthRequired.addListener((details,callback)=>{void auth(details).then(callback,()=>callback({cancel:true}));},{urls:['<all_urls>']},['asyncBlocking']);
  ext.proxy.onProxyError.addListener(()=>{problem='The proxy connection failed. Retry or disconnect to use your normal connection.';});
}
for(const event of [ext.webRequest.onCompleted,ext.webRequest.onErrorOccurred])event.addListener(details=>attempts.delete(details.requestId),{urls:['<all_urls>']});
ext.runtime.onStartup.addListener(()=>{void serialize(async()=>{await save();if(state.active)await policy(true);}).catch(()=>{problem='Could not restore the connection. Disconnect and try again.';});});
ext.runtime.onInstalled.addListener(()=>{void serialize(save);});
