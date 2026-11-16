const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createOAuth}=require('../lib/oauth');

function fixture({data=new Map(),env:extra={}}={}) {
  const routes={},calls=[];
  const env={APP_URL:'https://vpn.example',SESSION_ENCRYPTION_KEY:'ab'.repeat(32),...extra};
  const missing=()=>Object.assign(Error('Not found'),{code:404});
  const records={
    async put(k,v){if(data.has(k))throw Object.assign(Error('Conflict'),{code:412});data.set(k,v);},
    async get(k){if(!data.has(k))throw missing();return data.get(k);},
    async take(k){if(!data.has(k))throw missing();const v=data.get(k);data.delete(k);return v;}
  };
  let proxy=async url=>({ok:true,status:200,json:async()=>url.endsWith('/verify')?{success:true,resetToken:'gateway-reset-secret'}:{success:true}});
  const oauth=createOAuth({env,records,fetchImpl:async(url,options)=>{calls.push({url,options});return proxy(url,options);}});
  oauth.mount({get:(path,handler)=>routes[path]=handler,post:(path,handler)=>routes[path]=handler});
  async function call(action,body={},headers={}) {
    const req={body,headers:{origin:env.APP_URL,'x-vpn-request':'1',...headers}};
    const res={code:200,cookies:[],headers:{},set(k,v){this.headers[k]=v;},append(k,v){this.cookies.push(v);},status(n){this.code=n;return this;},sendStatus(n){this.code=n;return this;},json(body){this.body=body;return this;}};
    await routes['/api/auth/email/'+action](req,res);
    return res;
  }
  async function verified(email='friend@example.com') {
    const response=await call('verify-reset-code',{email,code:'123456'});
    assert.equal(response.code,200);
    return response.cookies.find(c=>c.startsWith('__Host-vpn-reset=')).split(';')[0];
  }
  return {call,verified,data,records,calls,oauth,setProxy:p=>proxy=p};
}

test('password reset uses SKO endpoints, encrypts the reset token, and never signs the user in',async()=>{
  const f=fixture();
  const sent=await f.call('forgot-password',{email:' Friend@Example.com '});
  assert.equal(sent.code,200);assert.match(sent.body.message,/If this email has an SKO account/);
  assert.equal(sent.headers['Cache-Control'],'no-store');assert.equal(sent.cookies.length,0);
  assert.equal(f.calls[0].url,'https://oauth.skoonline.org/user/forgot-password');
  assert.deepEqual(JSON.parse(f.calls[0].options.body),{email:'friend@example.com'});
  const verifiedBody={email:'friend@example.com',code:'123456',resetToken:'untrusted-browser-token'};
  const verified=await f.call('verify-reset-code',verifiedBody);
  assert.equal(verified.code,200);assert.equal(verifiedBody.code,undefined);assert.equal(verifiedBody.resetToken,undefined);
  assert.match(verified.cookies[0],/^__Host-vpn-reset=[\w-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=900$/);
  assert.equal(f.calls[1].url,'https://oauth.skoonline.org/user/verify');
  assert.deepEqual(JSON.parse(f.calls[1].options.body),{email:'friend@example.com',code:'123456'});
  assert.ok([...f.data.values()].every(v=>!v.includes('gateway-reset-secret')&&!v.includes('friend@example.com')));
  const body={email:'friend@example.com',newPassword:'my-new-password',resetToken:'untrusted-browser-token'};
  const reset=await f.call('reset-password',body,{cookie:verified.cookies[0].split(';')[0]});
  assert.equal(reset.code,200);assert.match(reset.body.message,/Sign in/);
  assert.equal(body.newPassword,undefined);assert.equal(body.resetToken,undefined);
  assert.equal(f.calls[2].url,'https://oauth.skoonline.org/user/reset-password');
  assert.deepEqual(JSON.parse(f.calls[2].options.body),{resetToken:'gateway-reset-secret',newPassword:'my-new-password'});
  assert.equal(f.calls[2].options.redirect,'error');assert.ok(f.calls[2].options.signal instanceof AbortSignal);
  assert.ok(reset.cookies.every(c=>c.endsWith('Max-Age=0')));
  assert.equal([...f.data.keys()].filter(k=>k.startsWith('auth/password-resets/')).length,0);
  assert.ok(!JSON.stringify(reset.body).includes('gateway-reset-secret'));
  assert.ok([...f.data.values()].every(v=>!v.includes('my-new-password')));
});

test('reset routes reject missing configuration, CSRF, malformed input, and browser-supplied tokens',async()=>{
  for(const action of ['forgot-password','verify-reset-code','reset-password']) {
    for(const headers of [{origin:'https://evil.example'},{'x-vpn-request':undefined}]) {
      const f=fixture(),body={email:'friend@example.com',code:'123456',newPassword:'my-new-password'};
      assert.equal((await f.call(action,body,headers)).code,403);assert.equal(f.calls.length,0);assert.equal(body.newPassword,undefined);
    }
    const unavailable=fixture({env:{SESSION_ENCRYPTION_KEY:''}});
    assert.equal((await unavailable.call(action,{email:'friend@example.com'})).code,503);assert.equal(unavailable.calls.length,0);
    for(const email of ['',null,{},'invalid','a'.repeat(250)+'@example.com']) {
      const f=fixture();assert.equal((await f.call(action,{email})).code,400);assert.equal(f.calls.length,0);
    }
  }
  for(const code of ['12345','1234567','abcdef',123456,{}]) {
    const f=fixture();assert.equal((await f.call('verify-reset-code',{email:'friend@example.com',code})).code,400);assert.equal(f.calls.length,0);
  }
  const f=fixture();
  const reset=await f.call('reset-password',{email:'friend@example.com',newPassword:'my-new-password',resetToken:'forged'});
  assert.equal(reset.code,400);assert.equal(reset.body.restartReset,true);assert.equal(f.calls.length,0);
});

test('send and verification quotas are durable across instances; completion has its own quota',async()=>{
  const data=new Map(),a=fixture({data}),b=fixture({data});
  for(let i=0;i<3;i++)assert.equal((await (i%2?a:b).call('forgot-password',{email:'friend@example.com'})).code,200);
  assert.equal((await a.call('forgot-password',{email:' FRIEND@EXAMPLE.COM '})).code,429);
  assert.equal(a.calls.length+b.calls.length,3);
  a.setProxy(async()=>({ok:false,status:400,json:async()=>({error:'private upstream error'})}));
  for(let i=0;i<4;i++)assert.equal((await a.call('verify-reset-code',{email:'friend@example.com',code:'000000'})).code,400);
  const cookie=await b.verified();
  assert.equal((await a.call('verify-reset-code',{email:'friend@example.com',code:'123456'})).code,429);
  const reset=await b.call('reset-password',{email:'friend@example.com',newPassword:'my-new-password'},{cookie});
  assert.equal(reset.code,200);
});

test('a registration response or unsuccessful verification cannot issue a password-reset cookie',async()=>{
  for(const reply of [{success:true,token:'registration-token',user:{email:'friend@example.com'}},{success:true},{success:true,resetToken:''},{success:false,resetToken:'should-not-use'},{resetToken:'should-not-use'}]) {
    const f=fixture();f.setProxy(async()=>({ok:true,status:200,json:async()=>reply}));
    const response=await f.call('verify-reset-code',{email:'friend@example.com',code:'123456'});
    assert.equal(response.code,400);assert.equal(response.cookies.length,0);
    assert.equal([...f.data.keys()].filter(k=>k.startsWith('auth/password-resets/')).length,0);
  }
});

test('reset requires the verified email and an unexpired reset cookie',async t=>{
  const f=fixture(),cookie=await f.verified();
  assert.equal((await f.call('reset-password',{email:'other@example.com',newPassword:'my-new-password'},{cookie})).code,400);
  const now=Date.now();t.mock.method(Date,'now',()=>now+900001);
  const expired=await f.call('reset-password',{email:'friend@example.com',newPassword:'my-new-password'},{cookie});
  assert.equal(expired.code,400);assert.equal(expired.body.restartReset,true);assert.equal(f.calls.length,1);
});

test('password policy is checked before consuming the reset; Unicode bytes are bounded',async()=>{
  const f=fixture(),cookie=await f.verified();
  for(const newPassword of ['',7,'short','x'.repeat(73),'汉'.repeat(25),'😀'.repeat(4)]) {
    const response=await f.call('reset-password',{email:'friend@example.com',newPassword},{cookie});
    assert.equal(response.code,400);assert.equal(response.body.restartReset,undefined);assert.equal(f.calls.length,1);
  }
  const response=await f.call('reset-password',{email:'friend@example.com',newPassword:'汉'.repeat(8)},{cookie});
  assert.equal(response.code,200);
});

test('a reset is single-use under replay and concurrent requests across instances',async()=>{
  const data=new Map(),a=fixture({data}),b=fixture({data}),cookie=await a.verified();
  const requests=await Promise.all([a,b].map(f=>f.call('reset-password',{email:'friend@example.com',newPassword:'my-new-password'},{cookie})));
  assert.deepEqual(requests.map(r=>r.code).sort(),[200,400]);
  const replay=await a.call('reset-password',{email:'friend@example.com',newPassword:'second-password'},{cookie});
  assert.equal(replay.code,400);assert.equal(a.calls.length+b.calls.length,2);
});

test('uncertain password writes and upstream errors never leak details or retry consumed tokens',async()=>{
  for(const failure of ['network','json','gateway','limit']) {
    const f=fixture(),cookie=await f.verified();
    f.setProxy(async()=>{
      if(failure==='network')throw Error('private gateway-reset-secret');
      return {ok:failure==='json',status:failure==='gateway'?500:429,json:async()=>{
        if(failure==='json')throw Error('private gateway-reset-secret');
        return {success:false,error:'private gateway-reset-secret'};
      }};
    });
    const response=await f.call('reset-password',{email:'friend@example.com',newPassword:'my-new-password'},{cookie});
    assert.equal(response.code,failure==='limit'?429:502);assert.equal(response.body.restartReset,true);
    assert.ok(!JSON.stringify(response.body).includes('gateway-reset-secret'));
    const replay=await f.call('reset-password',{email:'friend@example.com',newPassword:'my-new-password'},{cookie});
    assert.equal(replay.code,400);assert.equal(f.calls.length,2);
  }
});

test('storage failures fail closed before sending reset credentials upstream',async()=>{
  const f=fixture(),cookie=await f.verified();
  f.records.take=async()=>{throw Error('private storage path');};
  const response=await f.call('reset-password',{email:'friend@example.com',newPassword:'my-new-password'},{cookie});
  assert.equal(response.code,502);assert.equal(f.calls.length,1);assert.ok(!JSON.stringify(response.body).includes('private'));
});

test('HTTP reset flow works before sign-in and exchanges only opaque cookies with the browser',async t=>{
  const express=require('express'),app=express(),f=fixture();app.use(express.json());f.oauth.mount(app);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
  const base='http://127.0.0.1:'+server.address().port;
  const call=(action,body,cookie)=>fetch(base+'/api/auth/email/'+action,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://vpn.example','X-VPN-Request':'1',...(cookie?{cookie}:{})},body:JSON.stringify(body)});
  const send=await call('forgot-password',{email:'friend@example.com'});assert.equal(send.status,200);
  const verified=await call('verify-reset-code',{email:'friend@example.com',code:'123456'});assert.equal(verified.status,200);
  const cookie=verified.headers.getSetCookie()[0];assert.match(cookie,/HttpOnly; Secure; SameSite=Lax/);
  assert.ok(!(await verified.text()).includes('gateway-reset-secret'));
  const reset=await call('reset-password',{email:'friend@example.com',newPassword:'my-new-password'},cookie.split(';')[0]);
  assert.equal(reset.status,200);assert.equal(reset.headers.get('cache-control'),'no-store');
  assert.ok(reset.headers.getSetCookie().every(c=>c.endsWith('Max-Age=0')));
  const replay=await call('reset-password',{email:'friend@example.com',newPassword:'another-password'},cookie.split(';')[0]);
  assert.equal(replay.status,400);assert.equal(f.calls.length,3);
});
