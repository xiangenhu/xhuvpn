const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createOAuth}=require('../lib/oauth');
test('OAuth rejection returns safe diagnostic JSON and a recovery link for browser navigation',async()=>{
 for(const status of [400,401,403,500]) {
  const f=fixture(undefined,{},status),res=f.response();
  await f.routes['/api/auth/oauth/start']({method:'POST',headers:{origin:'https://vpn.example','x-vpn-request':'1'}},res);
  assert.equal(res.code,502);assert.equal(res.body.code,'oauth_proxy_'+status);
  assert.ok(!JSON.stringify(res.body).includes('secret'));assert.equal(res.cookies.length,0);
  const page=f.response();await f.routes['/api/auth/oauth/start']({method:'GET'},page);
  assert.match(page.body,/href="\/"/);assert.match(page.body,new RegExp('oauth_proxy_'+status));
 }
});
function fixture(email='xiangenhu@gmail.com', extra={}, proxyFailure, claims={email_verified:true}) {
 const routes={}, data=new Map(), calls=[];
 const env={APP_URL:'https://vpn.example',PROXY_CLIENT_ID:'xhuvpn',PROXY_CLIENT_SECRET:'test-secret',SESSION_ENCRYPTION_KEY:'ab'.repeat(32),...extra};
 const records={put:async(k,v)=>data.set(k,v),get:async k=>{if(!data.has(k))throw Error();return data.get(k);},take:async k=>{if(!data.has(k))throw Error();const v=data.get(k);data.delete(k);return v;}};
 const oauth=createOAuth({env,records,fetchImpl:async(url,options)=>{calls.push({url,options});if(proxyFailure)return {ok:false,status:proxyFailure,json:async()=>({error:'secret response must not leak'})};return {ok:true,json:async()=>url.endsWith('/start')?{url:'https://oauth.skoonline.org/authorize'}:{user:{email,provider:'google',...claims}}};}});
 oauth.mount({get:(p,h)=>routes[p]=h,post:(p,h)=>routes[p]=h});
 function response(){return {code:200,cookies:[],set(){return this},append(k,v){this.cookies.push(v);return this},status(n){this.code=n;return this},send(v){this.body=v;return this},sendStatus(n){this.code=n;return this},json(v){this.body=v;return this},redirect(v){this.redirected=v;return this}};}
 async function login(stateOverride){const start=response();await routes['/api/auth/oauth/start']({},start);const state=JSON.parse(calls[0].options.body).state;const req={headers:{cookie:start.cookies[0].split(';')[0]},query:{state:stateOverride || state,code:'single-code'}};const callback=response();await routes['/api/auth/oauth/callback'](req,callback);return {req,callback};}
 return {oauth,routes,data,calls,response,login};
}
test('Google owner login produces encrypted server session and admin role',async()=>{const f=fixture();const {callback}=await f.login();assert.equal(callback.redirected,'/');assert.ok(callback.cookies.some(c=>c.includes('HttpOnly; Secure; SameSite=Lax')));assert.ok([...f.data.values()].every(v=>!v.includes('xiangenhu')));const req={headers:{cookie:callback.cookies.find(c=>c.startsWith('__Host-vpn-session')).split(';')[0]},method:'GET'};let next=false;await f.oauth.auth(req,f.response(),()=>next=true);assert.ok(next);assert.equal(req.authType,'admin');assert.equal(req.user.email,'xiangenhu@gmail.com');});
test('without access service, environment overrides cannot authorize another Google identity',async()=>{const f=fixture('friend@example.com',{ADMIN_EMAILS:'friend@example.com',ALLOWED_EMAILS:'friend@example.com'});const {callback}=await f.login();assert.equal(callback.code,403);assert.ok(!callback.cookies.some(c=>c.startsWith('__Host-vpn-session')));});
test('state mismatch denied before token exchange',async()=>{const f=fixture();const {callback}=await f.login('wrong');assert.equal(callback.code,401);assert.equal(f.calls.length,1);});
test('callback replay rejected',async()=>{const f=fixture();const {req}=await f.login();const res=f.response();await f.routes['/api/auth/oauth/callback'](req,res);assert.equal(res.code,401);assert.equal(f.calls.length,2);});
test('API keys and bearer/query tokens cannot grant access',async()=>{const f=fixture();const res=f.response();await f.oauth.auth({headers:{'x-api-key':'old-secret',authorization:'Bearer fake'},query:{key:'fake',token:'fake'},method:'GET'},res,()=>assert.fail());assert.equal(res.code,401);});
test('cross-origin writes rejected, same-origin writes accepted',async()=>{const f=fixture();const {callback}=await f.login();const headers={cookie:callback.cookies.find(c=>c.startsWith('__Host-vpn-session')).split(';')[0],origin:'https://evil.example','x-vpn-request':'1'};const res=f.response();await f.oauth.auth({headers,method:'POST'},res,()=>assert.fail());assert.equal(res.code,403);headers.origin='https://vpn.example';let ok=false;await f.oauth.auth({headers,method:'POST'},f.response(),()=>ok=true);assert.ok(ok);});
test('missing session encryption configuration fails closed',async()=>{const f=fixture(undefined,{SESSION_ENCRYPTION_KEY:''});const res=f.response();await f.oauth.auth({headers:{},method:'GET'},res,()=>assert.fail());assert.equal(res.code,503);});
test('logout invalidates session',async()=>{const f=fixture();const {callback}=await f.login();const headers={cookie:callback.cookies.find(c=>c.startsWith('__Host-vpn-session')).split(';')[0],origin:'https://vpn.example'};await f.routes['/api/auth/logout']({headers},f.response());const res=f.response();await f.oauth.auth({headers,method:'GET'},res,()=>assert.fail());assert.equal(res.code,401);});

test('Google sign-in requires an explicitly verified email identity',async()=>{
 for(const claims of [{},{email_verified:false},{email_verified:true,verified:false}]) {
  const f=fixture(undefined,{},undefined,claims),{callback}=await f.login();assert.equal(callback.code,401);assert.ok(!callback.cookies.some(c=>c.startsWith('__Host-vpn-session')));
 }
});
