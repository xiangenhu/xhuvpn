const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseInventory,mergeInventory}=require('../lib/device-setup');
const server='yBq5ZCvbOkpnai8JrC+qYiLrLIeit99QWiwW4ZGKbG0=';
const phone='8vH2sSmzCKmf2D3gs+eSWe5J11xwWNZc2Xpz2Hak53M=';
test('imports manual devices without private keys and is repeatable',()=>{
 const inventory=parseInventory(`${server}\n${phone}\t10.8.0.3/32\n`,'10.8.0');
 const state={peers:[]};assert.equal(mergeInventory(state,inventory,'owner'),1);
 assert.equal(mergeInventory(state,inventory,'owner'),0);
 assert.equal(state.peers[0].ip,'10.8.0.3');assert.equal(state.peers[0].privKey,undefined);
});
test('refuses unsupported routes and conflicting saved addresses',()=>{
 assert.throws(()=>parseInventory(`${server}\n${phone}\t0.0.0.0/0`,'10.8.0'));
 assert.throws(()=>parseInventory(`${server}\n${phone}\t10.8.0.3/32,10.8.0.4/32`,'10.8.0'));
 const inventory=parseInventory(`${server}\n${phone}\t10.8.0.3/32`,'10.8.0');
 assert.throws(()=>mergeInventory({peers:[{pubKey:server,ip:'10.8.0.3'}]},inventory,'owner'));
});
