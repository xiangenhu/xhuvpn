const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createOAuth}=require('../lib/oauth');
const {createAccess}=require('../lib/access');
function fixture(extra={}) {
 const routes={},data=new Map();let state={users:{},invites:{},peers:[]},calls=0;
 const access=createAccess({origin:'https://vpn.example',store:{read:async()=>({value:state}),update:async fn=>{const copy=structuredClone(state);const result=fn(copy);state=copy;return result;}}});
 const env={APP_URL:'https://vpn.example',PROXY_CLIENT_ID:'test',PROXY_CLIENT_SECRET:'test',SESSION_ENCRYPTION_KEY:'aa'.repeat(32),...extra};
 let reply={token:'server-only-token',user:{email:'xiangenhu@gmail.com',emailVerified:true}};
 const oauth=createOAuth({env,access,records:{put:async(k,v)=>{if(data.has(k))throw Object.assign(Error(),{code:412});data.set(k,v);},get:async k=>data.get(k)},fetchImpl:async()=>{calls++;return {ok:true,json:async()=>reply};}});
 oauth.mount({get:(p,h)=>routes[p]=h,post:(p,h)=>routes[p]=h});
 function response(){return {code:200,cookies:[],set(){},append(k,v){this.cookies.push(v)},status(n){this.code=n;return this},sendStatus(n){this.code=n;return this},json(body){this.body=body;return this}};}
 async function login(email='xiangenhu@gmail.com',origin=env.APP_URL){const res=response(),req={headers:{origin,'x-vpn-request':'1'},body:{email,password:'test-password'}};await routes['/api/auth/email/login'](req,res);return res;}
 return {login,access,oauth,response,data,routes,setReply:r=>reply=r,calls:()=>calls,state:()=>state};
}
test('email sign-in and session work without OAuth client registration',async()=>{
 const f=fixture({PROXY_CLIENT_ID:'',PROXY_CLIENT_SECRET:''}),config=f.response();
 f.routes['/api/auth/config']({},config);
 assert.deepEqual(config.body,{enabled:true,emailLogin:true,googleLogin:false});
 const res=await f.login();assert.equal(res.code,200);
 let passed=false;
 await f.oauth.auth({headers:{cookie:res.cookies[0].split(';')[0]},method:'GET'},f.response(),()=>passed=true);
 assert.equal(passed,true);
 assert.equal((await fixture({SESSION_ENCRYPTION_KEY:''}).login()).code,503);
});
test('verified SMTP owner signs in as sole admin without storing password or proxy token',async()=>{
 const f=fixture(),res=await f.login();assert.equal(res.code,200);
 const req={headers:{cookie:res.cookies[0].split(';')[0]},method:'GET'};let passed=false;
 await f.oauth.auth(req,f.response(),()=>passed=true);assert.equal(passed,true);assert.equal(req.authType,'admin');
 assert.ok([...f.data.values()].every(v=>!v.includes('test-password')&&!v.includes('server-only-token')));
});
test('new verified proxy account waits for approval; code unlocks same session and disabling revokes VPN access while preserving account sign-in',async()=>{
 const f=fixture();f.setReply({token:'test',user:{email:'friend@example.com',emailVerified:true}});
 const login=await f.login('friend@example.com');assert.equal(login.code,200);assert.equal((await f.login('friend@example.com')).code,200);
 assert.equal(Object.keys(f.state().users).length,0);assert.equal(await f.access.role({email:'friend@example.com'}),'pending');
 const headers={cookie:login.cookies[0].split(';')[0],origin:'https://vpn.example','x-vpn-request':'1'};
 for(const [method,path] of [['GET','/api/peers'],['POST','/api/peers'],['GET','/api/peers/phone/config'],['GET','/api/status'],['POST','/api/admin/reconcile']]) {
   const res=f.response();await f.oauth.auth({headers,method,path},res,()=>assert.fail('pending user bypassed approval'));assert.equal(res.code,403);
 }
 for(const [method,path] of [['GET','/api/me'],['POST','/api/access/request'],['POST','/api/access/redeem']]) {
   let passed=false;await f.oauth.auth({headers,method,path},f.response(),()=>passed=true);assert.equal(passed,true);
 }
 const invite=await f.access.invite('friend@example.com');await f.access.redeem({email:'friend@example.com'},invite.code);
 let passed=false;await f.oauth.auth({headers,method:'GET',path:'/api/peers'},f.response(),()=>passed=true);assert.equal(passed,true);
 await f.access.disable('friend@example.com');assert.equal((await f.login('friend@example.com')).code,200);
 const blocked=f.response();await f.oauth.auth({headers,method:'GET',path:'/api/peers'},blocked,()=>assert.fail('Revoked account regained VPN access'));assert.equal(blocked.code,403);
});
test('SMTP login rejects missing/false verification, email mismatch, CSRF and excess attempts',async()=>{
 for(const user of [{email:'xiangenhu@gmail.com'},{email:'xiangenhu@gmail.com',emailVerified:false},{email:'xiangenhu@gmail.com',emailVerified:true,verified:false},{email:'other@example.com',emailVerified:true}]) {
   const f=fixture();f.setReply({token:'test',user});assert.equal((await f.login()).code,401);
 }
 const f=fixture();assert.equal((await f.login(undefined,'https://evil.example')).code,403);assert.equal(f.calls(),0);
 for(let i=0;i<5;i++)assert.equal((await f.login()).code,200);
 assert.equal((await f.login()).code,429);assert.equal(f.calls(),5);
});
