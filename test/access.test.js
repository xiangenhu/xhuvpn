const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createAccess,ADMIN}=require('../lib/access');
function fixture(){let state={users:{},invites:{},peers:[]};let clock=100000;const store={read:async()=>({value:structuredClone(state)}),update:async fn=>{const copy=structuredClone(state);const result=fn(copy);state=copy;return result;}};return {access:createAccess({store,origin:'https://vpn.example',now:()=>clock}),store,state:()=>state,advance:()=>clock+=8*86400000};}
test('invitation is bound to email, hashed at rest and one-use',async()=>{const f=fixture();const invite=await f.access.invite(' Friend@Example.com ');assert.equal(invite.email,'friend@example.com');assert.ok(invite.url.includes('/#invite='));assert.ok(!JSON.stringify(f.state()).includes(invite.code));await assert.rejects(f.access.redeem({email:'other@example.com'},invite.code));await f.access.redeem({email:invite.email},invite.code);assert.equal(await f.access.role({email:invite.email}),'user');await assert.rejects(f.access.redeem({email:invite.email},invite.code));});
test('expired and replaced invitations are rejected',async()=>{const f=fixture();const first=await f.access.invite('friend@example.com');const second=await f.access.invite(first.email);await assert.rejects(f.access.redeem({email:first.email},first.code));f.advance();await assert.rejects(f.access.redeem({email:second.email},second.code));});
test('disable revokes membership, all devices and pending invitation atomically',async()=>{const f=fixture();const invite=await f.access.invite('friend@example.com');await f.access.redeem({email:invite.email},invite.code);await f.store.update(s=>s.peers.push({name:'phone',owner:invite.email},{name:'my-device',owner:ADMIN}));const next=await f.access.invite(invite.email);await f.access.disable(invite.email);assert.equal(await f.access.role({email:invite.email}),null);assert.deepEqual(f.state().peers,[{name:'my-device',owner:ADMIN}]);assert.equal(Object.keys(f.state().invites).length,0);await assert.rejects(f.access.redeem({email:invite.email},next.code));await assert.rejects(f.access.invite(invite.email));});
test('sole administrator cannot be invited or disabled',async()=>{const f=fixture();assert.equal(await f.access.role({email:ADMIN}),'admin');await assert.rejects(f.access.disable(ADMIN));await assert.rejects(f.access.invite(ADMIN));assert.equal(await f.access.role({email:'intruder@example.com'}),null);});
test('pending invitations count toward nine-friend limit',async()=>{const f=fixture();for(let i=0;i<9;i++)await f.access.invite(`friend${i}@example.com`);await assert.rejects(f.access.invite('tenth@example.com'));await f.access.invite('friend0@example.com');});
test('verified proxy registration remains pending until admin code and cannot reactivate disabled users',async()=>{
 const f=fixture();await f.access.registerVerifiedEmail({email:ADMIN});assert.equal(Object.keys(f.state().users).length,0);
 await f.access.registerVerifiedEmail({email:'friend@example.com'});await f.access.registerVerifiedEmail({email:'FRIEND@example.com'});
 assert.equal(Object.keys(f.state().users).length,0);assert.equal(await f.access.role({email:'friend@example.com'}),'pending');
 assert.equal(Object.keys(f.state().requests).length,1);
 assert.equal((await f.access.summary()).requests.length,0);
 await f.access.requestApproval({email:'friend@example.com'});
 assert.equal((await f.access.summary()).requests.length,1);
 assert.equal((await f.access.requestApproval({email:'friend@example.com'})).alreadyRequested,true);
 await f.access.disable('friend@example.com');await assert.rejects(f.access.registerVerifiedEmail({email:'friend@example.com'}));
 for(let i=0;i<9;i++)await f.access.invite(`reserved${i}@example.com`);
 await f.access.registerVerifiedEmail({email:'stranger@example.com'});assert.equal(await f.access.role({email:'stranger@example.com'}),'pending');
 await assert.rejects(f.access.invite('stranger@example.com'));
 const invite=await f.access.invite('reserved0@example.com');
 await f.access.registerVerifiedEmail({email:invite.email});
 await f.access.redeem({email:invite.email},invite.code);assert.equal(await f.access.role({email:invite.email}),'user');
 assert.equal(f.state().requests[invite.email],undefined);
});
