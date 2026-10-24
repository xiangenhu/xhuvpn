const {test}=require('node:test'),assert=require('node:assert/strict');
const {credentials,validSession,bypass}=require('../extension/core');
const fs=require('node:fs'),vm=require('node:vm');
const session=()=>({id:'a'.repeat(43),password:'b'.repeat(43),expires:Date.now()+10000,proxy:{scheme:'https',host:'proxy.example.test',port:8443}});
test('proxy credentials never go to website auth, other proxies, wrong ports, expired sessions or retry loops',()=>{
 const s=session(),challenge={isProxy:true,requestId:'one',challenger:{host:s.proxy.host,port:8443}};
 assert.equal(credentials(challenge,s).authCredentials.password,s.password);
 assert.deepEqual(credentials({...challenge,isProxy:false},s),{});
 assert.deepEqual(credentials({...challenge,challenger:{host:'evil.example',port:8443}},s),{});
 assert.deepEqual(credentials({...challenge,challenger:{host:s.proxy.host,port:443}},s),{});
 assert.equal(credentials(challenge,s,true).cancel,true);
 assert.equal(credentials(challenge,{...s,expires:0}).cancel,true);
 assert.equal(validSession(s),true);assert.equal(validSession({...s,proxy:{...s.proxy,scheme:'http'}}),false);
 assert.equal(bypass('vpn.skoonline.org','vpn.skoonline.org',s.proxy.host),true);
 assert.equal(bypass('vpn.skoonline.org.evil.test','vpn.skoonline.org',s.proxy.host),false);
});
test('both extension packages declare browser-specific auth and background APIs without embedded credentials',()=>{
 const chrome=JSON.parse(fs.readFileSync(require.resolve('../extension/manifest.chromium.json')));
 const firefox=JSON.parse(fs.readFileSync(require.resolve('../extension/manifest.firefox.json')));
 assert.ok(chrome.permissions.includes('webRequestAuthProvider'));assert.ok(!chrome.permissions.includes('webRequestBlocking'));
 assert.ok(firefox.permissions.includes('webRequestBlocking'));assert.ok(firefox.background.scripts.includes('core.js'));
 for(const m of [chrome,firefox])assert.equal(m.incognito,'not_allowed');
 for(const file of ['core.js','background.js','popup.js'])new vm.Script(fs.readFileSync(require.resolve('../extension/'+file),'utf8'));
});
