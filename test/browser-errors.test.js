const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require.resolve('../public/index.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script);
const helper=script.slice(script.indexOf('  async function jsonRequest('),script.indexOf('\n  async function ',script.indexOf('  async function jsonRequest(')+10));
function request(apiFetch){return vm.runInNewContext(helper+';jsonRequest',{apiFetch});}
test('browser reports readable errors for non-JSON deployment responses and network failures',async()=>{
 const badJSON=async()=>{throw new SyntaxError('The string did not match the expected pattern.');};
 await assert.rejects(request(async()=>({status:403,json:badJSON}))('/api/auth/email/login',{}),/Refresh the page/);
 await assert.rejects(request(async()=>({status:503,json:badJSON}))('/api/auth/email/login',{}),/temporarily unavailable/);
 await assert.rejects(request(async()=>{throw new TypeError('Load failed');})('/api/auth/email/login',{}),/Check your connection/);
 const result=await request(async()=>({ok:true,json:async()=>({ok:true})}))('/api/auth/email/login',{});
 assert.equal(result.ok,true);
});
