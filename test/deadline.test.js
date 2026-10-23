const {test}=require('node:test');
const assert=require('node:assert/strict');
const {withDeadline}=require('../lib/deadline');
test('stalled VM operation expires and closes the connection',async()=>{
 let closed=false;
 await assert.rejects(withDeadline(new Promise(()=>{}),5,()=>{closed=true;}),e=>e.code==='VPN_TIMEOUT');
 assert.equal(closed,true);
});
test('completed VM operation keeps its result without premature cleanup',async()=>{
 let closed=false;
 assert.equal(await withDeadline(Promise.resolve('profile'),20,()=>{closed=true;}),'profile');
 assert.equal(closed,false);
});
