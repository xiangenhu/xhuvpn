const {test}=require('node:test');
const assert=require('node:assert/strict');
const {sendInvitation,sendApprovalRequest}=require('../lib/smtp');
test('SMTP uses server client authentication and stable request IDs; uncertain failures are not retried',async()=>{
 const invitation={email:'friend@example.com',code:'one-code',url:'https://vpn.example/#invite=one-code',expires:'tomorrow'};
 const requests=[],env={PROXY_CLIENT_ID:'test',PROXY_CLIENT_SECRET:'secret'};
 const fetchImpl=async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({success:true})};};
 await sendInvitation(invitation,{env,fetchImpl});await sendInvitation(invitation,{env,fetchImpl});
 assert.equal(requests[0].options.body,requests[1].options.body);assert.match(requests[0].options.headers.Authorization,/^Basic /);
 const message=JSON.parse(requests[0].options.body);
 assert.equal(message.to,invitation.email);assert.match(message.subject,/connection instructions/);
 for(const text of [invitation.code,invitation.url,invitation.expires,'Prepare my configuration file','.conf','Import tunnel(s) from file','Activate','xiangenhu@gmail.com'])assert.ok(message.body.includes(text),text);
 let count=0;await assert.rejects(sendInvitation(invitation,{env,fetchImpl:async()=>{count++;throw Error('timeout');}}));assert.equal(count,1);
 await assert.rejects(sendInvitation(invitation,{env,fetchImpl:async()=>({ok:true,json:async()=>({success:false})})}));
});
test('approval email goes only to administrator and keeps stable retry identity',async()=>{
 const calls=[];const options={env:{PROXY_CLIENT_ID:'test',PROXY_CLIENT_SECRET:'test',APP_URL:'https://vpn.example'},fetchImpl:async(url,opts)=>{calls.push(JSON.parse(opts.body));return {ok:true,json:async()=>({success:true})};}};
 const request={email:'new@example.com',requestedAt:'2026-10-23T00:00:00Z'};
 await sendApprovalRequest(request,options);await sendApprovalRequest(request,options);
 assert.equal(calls[0].to,'xiangenhu@gmail.com');assert.equal(calls[0].requestId,calls[1].requestId);
 assert.match(calls[0].body,/new@example.com/);
});
