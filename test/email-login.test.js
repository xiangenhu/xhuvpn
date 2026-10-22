const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createOAuth}=require('../lib/oauth');
const {createAccess}=require('../lib/access');
function fixture() {
 const routes={},data=new Map();let state={users:{},invites:{},peers:[]},calls=0;
 const access=createAccess({origin:'https://vpn.example',store:{read:async()=>({value:state}),update:async fn=>{const copy=structuredClone(state);const result=fn(copy);state=copy;return result;}}});
 const env={APP_URL:'https://vpn.example',PROXY_CLIENT_ID:'test',PROXY_CLIENT_SECRET:'test',SESSION_ENCRYPTION_KEY:'aa'.repeat(32)};
 let reply={token:'server-only-token',user:{email:'xiangenhu@gmail.com',emailVerified:true}};
 const oauth=createOAuth({env,access,records:{put:async(k,v)=>{if(data.has(k))throw Object.assign(Error(),{code:412});data.set(k,v);},get:async k=>data.get(k)},fetchImpl:async()=>{calls++;return {ok:true,json:async()=>reply};}});
 oauth.mount({get:(p,h)=>routes[p]=h,post:(p,h)=>routes[p]=h});
 function response(){return {code:200,cookies:[],set(){},append(k,v){this.cookies.push(v)},status(n){this.code=n;return this},sendStatus(n){this.code=n;return this},json(body){this.body=body;return this}};}
 async function login(email='xiangenhu@gmail.com',origin=env.APP_URL){const res=response(),req={headers:{origin,'x-vpn-request':'1'},body:{email,password:'test-password'}};await routes['/api/auth/email/login'](req,res);return res;}
 return {login,access,oauth,response,data,setReply:r=>reply=r,calls:()=>calls,state:()=>state};
}
test('verified SMTP owner signs in as sole admin without storing password or proxy token',async()=>{
 const f=fixture(),res=await f.login();assert.equal(res.code,200);
 const req={headers:{cookie:res.cookies[0].split(';')[0]},method:'GET'};let passed=false;
 await f.oauth.auth(req,f.response(),()=>passed=true);assert.equal(passed,true);assert.equal(req.authType,'admin');
 assert.ok([...f.data.values()].every(v=>!v.includes('test-password')&&!v.includes('server-only-token')));
});
test('new verified proxy account registers once; disabling revokes email login',async()=>{
 const f=fixture();f.setReply({token:'test',user:{email:'friend@example.com',emailVerified:true}});
 assert.equal((await f.login('friend@example.com')).code,200);assert.equal((await f.login('friend@example.com')).code,200);
 assert.equal(Object.keys(f.state().users).length,1);assert.equal(await f.access.role({email:'friend@example.com'}),'user');
 await f.access.disable('friend@example.com');assert.equal((await f.login('friend@example.com')).code,403);
});
test('SMTP login rejects missing/false verification, email mismatch, CSRF and excess attempts',async()=>{
 for(const user of [{email:'xiangenhu@gmail.com'},{email:'xiangenhu@gmail.com',emailVerified:false},{email:'xiangenhu@gmail.com',emailVerified:true,verified:false},{email:'other@example.com',emailVerified:true}]) {
   const f=fixture();f.setReply({token:'test',user});assert.equal((await f.login()).code,401);
 }
 const f=fixture();assert.equal((await f.login(undefined,'https://evil.example')).code,403);assert.equal(f.calls(),0);
 for(let i=0;i<5;i++)assert.equal((await f.login()).code,200);
 assert.equal((await f.login()).code,429);assert.equal(f.calls(),5);
});
