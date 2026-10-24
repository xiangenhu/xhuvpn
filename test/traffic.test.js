const {test}=require('node:test');const assert=require('node:assert/strict');
const {parseDump,record,summary}=require('../lib/traffic');
test('direction, baseline, reset, stale sampling and retired device totals',()=>{
 const state={peers:[{pubKey:'key',owner:'member',name:'phone'}]};
 const sample=(upload,download)=>[{key:'key',handshake:1,upload,download}];
 record(state,sample(100,200),1000);assert.equal(summary(state).upload,0);
 record(state,sample(150,280),2000);record(state,sample(150,280),2000);
 assert.equal(summary(state).upload,50);assert.equal(summary(state).download,80);
 record(state,sample(10,20),3000);record(state,sample(200,300),2500);
 state.peers=[];record(state,[],4000);
 assert.equal(summary(state).upload,60);assert.equal(summary(state).download,100);
 assert.equal(summary(state).members[0].owner,'member');
 assert.equal(summary(state).daily[0].upload,60);
});
test('parse dump omits secrets and endpoint; reject malformed counters',()=>{
 const key='A'.repeat(43)+'=';
 const raw='private\tpublic\t51820\toff\n'+key+'\tsecret\tendpoint\t10.8.0.2/32\t1\t20\t30\t0';
 assert.deepEqual(parseDump(raw),[{key,handshake:1,upload:20,download:30}]);
 assert.throws(()=>parseDump(raw.replace('\t20\t','\tbad\t')));
});
