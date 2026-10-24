'use strict';
const crypto=require('node:crypto');
const {ADMIN,AccessError}=require('./access');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const random=()=>crypto.randomBytes(32).toString('base64url');
const token=value=>typeof value==='string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const userCode=value=>typeof value==='string' && /^[A-F0-9]{4}(-[A-F0-9]{4}){2}$/.test(value);
const allowed=(state,email,notice)=>Boolean(email && (email===ADMIN || state.users[email]?.enabled===true) && state.consent?.[email]?.version===notice);
function configuration(env) {
  if(!env.EXTENSION_PROXY_ORIGIN || !env.EXTENSION_GATEWAY_SECRET) return null;
  const url=new URL(env.EXTENSION_PROXY_ORIGIN);
  if(url.protocol!=='https:' || url.origin!==env.EXTENSION_PROXY_ORIGIN || url.username || url.password ||
     !/^[a-z0-9.-]+$/i.test(url.hostname) || !url.hostname.includes('.') || !/^[a-f0-9]{64}$/i.test(env.EXTENSION_GATEWAY_SECRET))
    throw Error('Extension proxy requires an HTTPS DNS origin and a private 64-hex gateway secret');
  return {origin:url.origin,host:url.hostname,port:Number(url.port || 443)};
}
function createExtensionAccess({store,records,noticeVersion,env=process.env,now=Date.now,fetchImpl=fetch}) {
  let config;
  try {config=configuration(env);}catch {config=null;console.warn('Extension proxy configuration is invalid; extension mode is disabled.');}
  const ready=()=>{if(!config)throw new AccessError(503,'The browser extension is awaiting its proxy server setup.');};
  const prune=state=>{
    state.extensionPairs ||= {};state.extensionSessions ||= {};
    for(const [id,p] of Object.entries(state.extensionPairs))if(p.expires<=now())delete state.extensionPairs[id];
    for(const [id,s] of Object.entries(state.extensionSessions))if(s.expires<=now())delete state.extensionSessions[id];
  };
  async function start(challenge,label,ip) {
    ready();
    if(!token(challenge) || !['Chrome / Edge / Brave / Opera','Firefox'].includes(label))throw new AccessError(400,'Restart Connect from the extension.');
    const window=Math.floor(now()/900000);let reserved=false;
    for(let slot=0;slot<10;slot++) {
      try {await records.put(`auth/extension-attempts/${hash(String(ip)+':'+window+':'+slot)}.json`,JSON.stringify({expires:(window+1)*900000}));reserved=true;break;}
      catch(e){if(e.code!==412)throw e;}
    }
    if(!reserved)throw new AccessError(429,'Too many connection attempts. Try again in 15 minutes.');
    // Do not invite users into a flow whose HTTPS gateway is not ready.
    let response;
    try {response=await fetchImpl(config.origin+'/healthz',{headers:{Authorization:'Bearer '+env.EXTENSION_GATEWAY_SECRET},redirect:'error',signal:AbortSignal.timeout(7000)});}
    catch {throw new AccessError(503,'The browser proxy is unreachable. Ask Xiangen to check its server and HTTPS certificate.');}
    if(!response.ok)throw new AccessError(503,'The browser proxy is not ready. Ask Xiangen to check its gateway credential.');
    const deviceCode=random(),code=crypto.randomBytes(6).toString('hex').toUpperCase().match(/.{4}/g).join('-');
    const expires=now()+600000;
    await store.update(state=>{
      prune(state);
      if(Object.keys(state.extensionPairs).length>=64)throw new AccessError(429,'Connection setup is busy. Try again later.');
      state.extensionPairs[hash(deviceCode)]={codeHash:hash(code),challenge,label,expires};
    });
    return {deviceCode,userCode:code,expires,interval:3};
  }
  async function info(code) {
    ready();if(!userCode(code))throw new AccessError(400,'Invalid connection code.');
    const state=(await store.read()).value;
    const pair=Object.values(state.extensionPairs || {}).find(p=>p.codeHash===hash(code) && p.expires>now());
    if(!pair)throw new AccessError(404,'This connection request expired. Click Connect in the extension again.');
    return {code,label:pair.label,expires:pair.expires,approved:Boolean(pair.owner)};
  }
  async function approve(code,email) {
    ready();if(!userCode(code))throw new AccessError(400,'Invalid connection code.');
    await store.update(state=>{
      prune(state);
      if(!allowed(state,email,noticeVersion))throw new AccessError(403,'VPN approval and the research-use agreement are required.');
      const pair=Object.values(state.extensionPairs).find(p=>p.codeHash===hash(code));
      if(!pair || pair.owner)throw new AccessError(409,'This connection request expired or was already approved.');
      pair.owner=email;
    });
    return {approved:true};
  }
  async function exchange(deviceCode,verifier) {
    ready();if(!token(deviceCode) || !token(verifier))throw new AccessError(400,'Invalid connection request.');
    const id=random(),password=random();
    return store.update(state=>{
      prune(state);const pair=state.extensionPairs[hash(deviceCode)];
      if(!pair || pair.challenge!==crypto.createHash('sha256').update(verifier).digest('base64url'))throw new AccessError(400,'Connection request expired. Click Connect again.');
      if(!pair.owner)return {status:'pending'};
      if(!allowed(state,pair.owner,noticeVersion))throw new AccessError(403,'Access is no longer approved.');
      if(Object.values(state.extensionSessions).filter(s=>s.owner===pair.owner).length>=3)throw new AccessError(409,'Disconnect an older extension connection from the portal before adding another.');
      const expires=now()+8*3600000;
      state.extensionSessions[id]={owner:pair.owner,secretHash:hash(password),expires,createdAt:new Date(now()).toISOString(),label:pair.label};
      delete state.extensionPairs[hash(deviceCode)];
      return {status:'connected',id,password,expires,proxy:{host:config.host,port:config.port,scheme:'https'}};
    });
  }
  async function completeSignIn(deviceCode,verifier,email) {
    ready();if(!token(deviceCode) || !token(verifier))throw new AccessError(400,'Restart Sign in & connect in the extension.');
    await store.update(state=>{
      prune(state);
      if(!allowed(state,email,noticeVersion))throw new AccessError(403,'VPN access approval and the research-use agreement are required.');
      const pair=state.extensionPairs[hash(deviceCode)];
      if(!pair || pair.challenge!==crypto.createHash('sha256').update(verifier).digest('base64url'))throw new AccessError(400,'This sign-in request expired. Start again from the extension.');
      if(pair.owner && pair.owner!==email)throw new AccessError(409,'This request belongs to a different signed-in account.');
      pair.owner=email;
    });
    return {approved:true};
  }
  async function verify(id,password) {
    ready();if(!token(id) || !token(password))return {ok:false};
    const state=(await store.read()).value,s=state.extensionSessions?.[id];
    return {ok:Boolean(s && s.expires>now() && s.secretHash===hash(password) && allowed(state,s.owner,noticeVersion)),expires:s?.expires || 0};
  }
  async function revoke(id,password,email) {
    if(!token(id))throw new AccessError(400,'Invalid connection.');
    await store.update(state=>{
      const session=state.extensionSessions?.[id];if(!session)return;
      if(email!==session.owner && email!==ADMIN && (!token(password) || session.secretHash!==hash(password)))throw new AccessError(403,'Not your connection.');
      delete state.extensionSessions[id];
    });return {revoked:true};
  }
  async function list(email) {
    const state=(await store.read()).value;
    return Object.entries(state.extensionSessions || {}).filter(([,s])=>s.owner===email && s.expires>now()).map(([id,s])=>({id,label:s.label,expires:s.expires}));
  }
  function gateway(req,res,next) {
    const expected='Bearer '+(env.EXTENSION_GATEWAY_SECRET || '');
    const given=req.headers.authorization || '';
    if(!config || Buffer.byteLength(expected)!==Buffer.byteLength(given) || !crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(given)))return res.sendStatus(403);
    next();
  }
  return {enabled:Boolean(config),start,info,approve,completeSignIn,exchange,verify,revoke,list,gateway};
}
module.exports={createExtensionAccess,configuration};
