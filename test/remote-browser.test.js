const {test}=require('node:test');const assert=require('node:assert/strict');
const {createRemoteBrowser}=require('../lib/remote-browser');
function fixture(){let state={users:{'a@example.com':{enabled:true},'b@example.com':{enabled:true}}};const calls=[];
 const store={read:async()=>({value:structuredClone(state)}),update:async fn=>{const copy=structuredClone(state);const r=fn(copy);state=copy;return r;}};
 let response={kasm_id:'session-a',user_id:'user-a'};
 const remote=createRemoteBrowser({store,env:{BROWSER_ORIGIN:'https://browser.example',BROWSER_API_KEY:'key',BROWSER_API_SECRET:'secret',BROWSER_IMAGE_ID:'image'},fetchImpl:async(url,opts)=>{calls.push({url,body:JSON.parse(opts.body)});if(response instanceof Error)throw response;return {ok:true,json:async()=>response};}});
 return {remote,store,calls,set:r=>response=r};}
test('browser sessions are owned, shared sessions disabled, and disabled users get no launch link',async()=>{
 const f=fixture();await f.remote.start('a@example.com');assert.equal(f.calls[0].body.enable_sharing,false);
 assert.equal((await f.remote.status('b@example.com')).status,'none');
 await assert.rejects(f.remote.start('a@example.com'));assert.equal(f.calls.length,1);
 f.set({kasm:{operational_status:'running'},kasm_url:'/#/connect/kasm/session-a/user-a/token'});
 assert.equal((await f.remote.status('a@example.com')).status,'running');
 await f.store.update(s=>{s.users['a@example.com'].enabled=false;});await assert.rejects(f.remote.status('a@example.com'));
 f.set({});await f.remote.stop('a@example.com');assert.equal(f.calls.at(-1).body.kasm_id,'session-a');
 f.set({error_message:'Invalid kasm_id (session-a)'});assert.equal((await f.remote.status('a@example.com')).status,'none');
});
test('uncertain creates do not duplicate sessions and foreign launch URLs are rejected',async()=>{
 const f=fixture();f.set(Error('timeout'));await assert.rejects(f.remote.start('a@example.com'));await assert.rejects(f.remote.start('a@example.com'));assert.equal(f.calls.length,1);
 assert.equal((await f.remote.status('a@example.com')).status,'unconfirmed');
 const g=fixture();await g.remote.start('a@example.com');g.set({kasm:{operational_status:'running'},kasm_url:'https://evil.example/#/connect/kasm/a'});await assert.rejects(g.remote.status('a@example.com'));
});
