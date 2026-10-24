const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseInventory,mergeInventory,preserveExistingDevices,vpnEndpoint}=require('../lib/device-setup');
test('profile endpoint uses the VPN machine when setup used the portal address',()=>{
 const vm='203.0.113.10',portal='https://vpn.skoonline.org';
 for(const value of [undefined,'','vpn.skoonline.org',portal,portal+'/'])assert.equal(vpnEndpoint(vm,value,portal),vm);
 assert.equal(vpnEndpoint(vm,vm,portal),vm);
 assert.equal(vpnEndpoint(vm,'different-vm.example',portal),'different-vm.example');
});
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
test('member enrollment preserves manual peers under the administrator without resurrecting retired peers',()=>{
 const retired='r'.repeat(43)+'=',removed='m'.repeat(43)+'=';
 const state={peers:[],retiredPeerKeys:{[retired]:true}};
 const inventory={peers:[{pubKey:phone,ip:'10.8.0.2'},{pubKey:retired,ip:'10.8.0.3'},{pubKey:removed,ip:'10.8.0.4'}],managed:new Set([removed])};
 assert.equal(preserveExistingDevices(state,inventory,'admin@example.com'),1);
 assert.equal(state.peers.length,1);assert.equal(state.peers[0].owner,'admin@example.com');
 assert.equal(state.peers[0].privKey,undefined);assert.equal(state.peers[0].pubKey,phone);
 assert.equal(preserveExistingDevices(state,inventory,'admin@example.com'),0);
 const stale={retiredPeerKeys:{[retired]:true},peers:[{pubKey:server,ip:'10.8.0.2',owner:'other@example.com',privKey:'keep-private'}]};
 assert.equal(preserveExistingDevices(stale,inventory,'admin@example.com'),1);
 assert.equal(stale.peers[0].needsRepair,true);assert.equal(stale.peers[0].owner,'other@example.com');assert.equal(stale.peers[0].privKey,'keep-private');
 assert.equal(stale.peers[1].pubKey,phone);assert.equal(stale.peers[1].needsRepair,undefined);
 assert.equal(preserveExistingDevices(stale,inventory,'admin@example.com'),0);
});
