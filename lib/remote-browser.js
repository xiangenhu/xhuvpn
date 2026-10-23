'use strict';
const crypto=require('node:crypto');
const {AccessError,ADMIN}=require('./access');
function createRemoteBrowser({store,env=process.env,fetchImpl=fetch}) {
  const origin=env.BROWSER_ORIGIN;
  const enabled=Boolean(origin && env.BROWSER_API_KEY && env.BROWSER_API_SECRET && env.BROWSER_IMAGE_ID);
  if(origin && (new URL(origin).protocol!=='https:' || new URL(origin).origin!==origin)) throw Error('BROWSER_ORIGIN must be an HTTPS origin');
  async function api(action,body) {
    if(!enabled) throw new AccessError(503,'Browser-only mode is awaiting server setup. WireGuard remains available.');
    const response=await fetchImpl(origin+'/api/public/'+action,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json'},body:JSON.stringify({api_key:env.BROWSER_API_KEY,api_key_secret:env.BROWSER_API_SECRET,...body})});
    if(!response.ok) throw Error('Remote browser service unavailable');
    return response.json();
  }
  const active=(state,email)=>email===ADMIN || state.users[email]?.enabled===true;
  async function start(email) {
    if(!enabled) throw new AccessError(503,'Browser-only mode is awaiting server setup.');
    const operation=crypto.randomUUID();
    await store.update(state=>{
      if(!active(state,email)) throw new AccessError(403,'Access revoked');
      state.browserSessions ||= {};
      if(state.browserSessions[email]) throw new AccessError(409,'A browser session already exists. Open it or end it before starting another.');
      state.browserSessions[email]={operation,status:'creating'};
    });
    // Do not automatically retry an ambiguous create: it could allocate another session.
    const result=await api('request_kasm',{image_id:env.BROWSER_IMAGE_ID,enable_sharing:false});
    if(result.error_message || typeof result.kasm_id!=='string' || typeof result.user_id!=='string') throw Error('Browser creation could not be confirmed');
    const session={operation,status:'starting',kasm_id:result.kasm_id,user_id:result.user_id};
    const permitted=await store.update(state=>{
      const ending=state.browserSessions[email]?.status==='ending';
      state.browserSessions[email]=session;
      return active(state,email) && !ending;
    });
    if(!permitted) {await stop(email);throw new AccessError(409,'Session was stopped or access revoked');}
    return {status:'starting'};
  }
  async function status(email) {
    const {value}=await store.read();const session=value.browserSessions?.[email];
    if(!session) return {status:'none',enabled};
    if(!session.kasm_id) return {status:'unconfirmed',enabled,message:'Session creation is pending or unconfirmed. Ask the administrator to check the browser service before retrying.'};
    const data=await api('get_kasm_status',{kasm_id:session.kasm_id,user_id:session.user_id});
    if(data.error_message?.startsWith('Invalid kasm_id')) {
      await store.update(s=>{if(s.browserSessions?.[email]?.operation===session.operation)delete s.browserSessions[email];});
      return {status:'none',enabled};
    }
    const status=String(data.kasm?.operational_status || data.operational_status || '').toLowerCase();
    if(status!=='running') return {status:session.status==='ending'?'ending':'starting',enabled};
    if(data.error_message || typeof data.kasm_url!=='string') throw Error('Browser connection is unavailable');
    const url=new URL(data.kasm_url,origin);
    if(url.origin!==origin || url.username || url.password || !url.hash.startsWith('#/connect/kasm/')) throw Error('Invalid browser session URL');
    // Recheck after external call; a concurrently disabled user must not receive a link.
    const latest=(await store.read()).value;
    if(!active(latest,email)) throw new AccessError(403,'Access revoked');
    if(latest.browserSessions?.[email]?.operation!==session.operation || latest.browserSessions[email].status==='ending') return {status:'ending',enabled};
    return {status:'running',enabled,url:url.href};
  }
  async function stop(email) {
    const session=await store.update(state=>{
      const item=state.browserSessions?.[email];if(item)item.status='ending';return item;
    });
    if(!session) return {status:'none'};
    if(!session.kasm_id) throw new AccessError(503,'Browser creation is unconfirmed. Administrator must inspect the browser service; automatic retry is blocked.');
    const result=await api('destroy_kasm',{kasm_id:session.kasm_id,user_id:session.user_id});
    if(result.error_message && !result.error_message.startsWith('Invalid kasm_id')) throw Error('Browser shutdown was not confirmed');
    if(result.error_message) await store.update(s=>{if(s.browserSessions?.[email]?.operation===session.operation)delete s.browserSessions[email];});
    return {status:'ending'};
  }
  return {enabled,start,status,stop};
}
module.exports={createRemoteBrowser};
