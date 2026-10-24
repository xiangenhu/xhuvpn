const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createExtensionAccess}=require('../lib/extension-access');
function fixture() {
 let time=Date.now(),state={users:{'friend@example.com':{enabled:true}},consent:{'friend@example.com':{version:'v1'}},invites:{},peers:[]};
 const records=new Set();let health=true;
 const access=createExtensionAccess({noticeVersion:'v1',now:()=>time,env:{EXTENSION_PROXY_ORIGIN:'https://proxy.example.test:8443',EXTENSION_GATEWAY_SECRET:'ab'.repeat(32)},
  store:{read:async()=>({value:structuredClone(state)}),update:async change=>{const copy=structuredClone(state);const result=change(copy);state=copy;return result;}},
  records:{put:async key=>{if(records.has(key))throw Object.assign(Error(),{code:412});records.add(key);}},fetchImpl:async()=>({ok:health})});
 const verifier='v'.repeat(43),challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
 return {access,verifier,challenge,state:()=>state,advance:ms=>{time+=ms;},unready:()=>{health=false;}};
}
test('extension pairing requires consent, PKCE, explicit approval and single use; only hashes persist',async()=>{
 const f=fixture();
 const pair=await f.access.start(f.challenge,'Firefox','test-ip');
 assert.equal((await f.access.exchange(pair.deviceCode,f.verifier)).status,'pending');
 await assert.rejects(f.access.exchange(pair.deviceCode,'x'.repeat(43)),e=>e.status===400);
 await assert.rejects(f.access.approve(pair.userCode,'uninvited@example.com'),e=>e.status===403);
 const info=await f.access.info(pair.userCode);assert.equal(info.label,'Firefox');assert.equal(info.approved,false);
 await f.access.approve(pair.userCode,'friend@example.com');
 await assert.rejects(f.access.approve(pair.userCode,'friend@example.com'),e=>e.status===409);
 const session=await f.access.exchange(pair.deviceCode,f.verifier);
 assert.equal(session.status,'connected');assert.equal(session.proxy.scheme,'https');
 assert.equal((await f.access.verify(session.id,session.password)).ok,true);
 assert.ok(!JSON.stringify(f.state()).includes(session.password));assert.ok(!JSON.stringify(f.state()).includes(pair.deviceCode));
 await assert.rejects(f.access.exchange(pair.deviceCode,f.verifier),e=>e.status===400);
 await assert.rejects(f.access.revoke(session.id,null,'other@example.com'),e=>e.status===403);
 await f.access.revoke(session.id,session.password);
 assert.equal((await f.access.verify(session.id,session.password)).ok,false);
});
test('disabled account, changed consent, expiry and gateway authentication fail closed',async()=>{
 const f=fixture(),pair=await f.access.start(f.challenge,'Firefox','one');await f.access.approve(pair.userCode,'friend@example.com');
 const s=await f.access.exchange(pair.deviceCode,f.verifier);
 f.state().users['friend@example.com'].enabled=false;
 assert.equal((await f.access.verify(s.id,s.password)).ok,false);
 f.state().users['friend@example.com'].enabled=true;f.state().consent['friend@example.com'].version='old';
 assert.equal((await f.access.verify(s.id,s.password)).ok,false);
 f.state().consent['friend@example.com'].version='v1';f.advance(8*3600000+1);
 assert.equal((await f.access.verify(s.id,s.password)).ok,false);
 let status,passed=false;
 const res={sendStatus:code=>{status=code;}};
 f.access.gateway({headers:{authorization:'Bearer wrong'}},res,()=>{passed=true;});assert.equal(status,403);assert.equal(passed,false);
 f.access.gateway({headers:{authorization:'Bearer '+'ab'.repeat(32)}},res,()=>{passed=true;});assert.equal(passed,true);
});
test('unconfigured or unhealthy gateway and anonymous request flooding do not issue connection grants',async()=>{
 const off=createExtensionAccess({store:{},records:{},noticeVersion:'v1',env:{}});
 await assert.rejects(off.start('v'.repeat(43),'Firefox','one'),e=>e.status===503);
 const f=fixture();for(let n=0;n<10;n++)await f.access.start(f.challenge,'Firefox','one');
 await assert.rejects(f.access.start(f.challenge,'Firefox','one'),e=>e.status===429);
 f.unready();await assert.rejects(f.access.start(f.challenge,'Firefox','two'),e=>e.status===503);
});
test('three-session quota, ten-minute request expiry and loss of approval are enforced atomically',async()=>{
 const f=fixture();
 for(let n=0;n<3;n++) {const p=await f.access.start(f.challenge,'Firefox','one');await f.access.approve(p.userCode,'friend@example.com');await f.access.exchange(p.deviceCode,f.verifier);}
 const fourth=await f.access.start(f.challenge,'Firefox','one');await f.access.approve(fourth.userCode,'friend@example.com');
 await assert.rejects(f.access.exchange(fourth.deviceCode,f.verifier),e=>e.status===409);
 const pending=await f.access.start(f.challenge,'Firefox','one');f.advance(600001);
 await assert.rejects(f.access.info(pending.userCode),e=>e.status===404);
 await assert.rejects(f.access.exchange(pending.deviceCode,f.verifier),e=>e.status===400);
});
test('automatic signed-in connection requires the local verifier and current granted account',async()=>{
 const f=fixture(),pair=await f.access.start(f.challenge,'Firefox','auto');
 await assert.rejects(f.access.completeSignIn(pair.deviceCode,'x'.repeat(43),'friend@example.com'),e=>e.status===400);
 await assert.rejects(f.access.completeSignIn(pair.deviceCode,f.verifier,'uninvited@example.com'),e=>e.status===403);
 f.state().consent['friend@example.com'].version='old';
 await assert.rejects(f.access.completeSignIn(pair.deviceCode,f.verifier,'friend@example.com'),e=>e.status===403);
 f.state().consent['friend@example.com'].version='v1';
 await f.access.completeSignIn(pair.deviceCode,f.verifier,'friend@example.com');
 const session=await f.access.exchange(pair.deviceCode,f.verifier);
 assert.equal(session.status,'connected');assert.equal((await f.access.verify(session.id,session.password)).ok,true);
 await assert.rejects(f.access.completeSignIn(pair.deviceCode,f.verifier,'friend@example.com'),e=>e.status===400);
});
