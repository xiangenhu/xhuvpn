const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../extension/signin.js'),'utf8');
for(const approved of [false,true])test('sign-in bridge '+(approved?'connects automatically after authenticated completion':'waits without bypassing account approval'),async()=>{
 const nodes={},actions=[];let posted=0;
 const document={getElementById:id=>nodes[id],createElement:()=>({setAttribute(){},style:{}}),body:{prepend:node=>{nodes[node.id]=node;}}};
 vm.runInNewContext(source,{
  chrome:{runtime:{sendMessage:async message=>{actions.push(message.action);return message.action==='signInRequest'?{mode:'pairing',deviceCode:'d'.repeat(43),verifier:'v'.repeat(43)}:{mode:'connected'};}}},document,AbortSignal,setInterval:()=>{},
  fetch:async(url,options)=>{
   posted++;assert.equal(url,'/api/extension/pair/complete');assert.equal(options.credentials,'same-origin');assert.equal(options.headers['X-VPN-Request'],'1');
   assert.equal(JSON.parse(options.body).verifier,'v'.repeat(43));
   return {status:approved?200:403,ok:approved,json:async()=>({approved:true})};
  }
 });
 await new Promise(setImmediate);assert.equal(posted,1);
 assert.equal(actions.includes('finishSignIn'),approved);
 assert.match(nodes['research-extension-connection'].textContent,approved?/connection is on/:/Sign in below/);
 assert.ok(!nodes['research-extension-connection'].textContent.includes('v'.repeat(43)));
});
