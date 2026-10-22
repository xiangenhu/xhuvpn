const {test}=require('node:test');
const assert=require('node:assert/strict');
const {sendInvitation}=require('../lib/smtp');
test('SMTP uses server client authentication and stable request IDs; uncertain failures are not retried',async()=>{
 const invitation={email:'friend@example.com',code:'one-code',url:'https://vpn.example/#invite=one-code',expires:'tomorrow'};
 const requests=[],env={PROXY_CLIENT_ID:'test',PROXY_CLIENT_SECRET:'secret'};
 const fetchImpl=async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({success:true})};};
 await sendInvitation(invitation,{env,fetchImpl});await sendInvitation(invitation,{env,fetchImpl});
 assert.equal(requests[0].options.body,requests[1].options.body);assert.match(requests[0].options.headers.Authorization,/^Basic /);
 let count=0;await assert.rejects(sendInvitation(invitation,{env,fetchImpl:async()=>{count++;throw Error('timeout');}}));assert.equal(count,1);
 await assert.rejects(sendInvitation(invitation,{env,fetchImpl:async()=>({ok:true,json:async()=>({success:false})})}));
});
