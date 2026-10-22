'use strict';
const crypto=require('node:crypto');
async function sendInvitation(invitation,{env=process.env,fetchImpl=fetch}={}) {
  if(!env.PROXY_CLIENT_ID || !env.PROXY_CLIENT_SECRET) throw Error('SMTP client is not configured');
  const response=await fetchImpl('https://oauth.skoonline.org/genai/services/smtp/send',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
    headers:{'Content-Type':'application/json',Authorization:'Basic '+Buffer.from(env.PROXY_CLIENT_ID+':'+env.PROXY_CLIENT_SECRET).toString('base64')},
    body:JSON.stringify({to:invitation.email,subject:'Your private VPN invitation',body:`You have been invited to the private VPN.\n\nOpen: ${invitation.url}\nInvitation code: ${invitation.code}\nExpires: ${invitation.expires}\n\nSign in with the invited Google account, or use your existing verified SKO email account.`,requestId:'vpn-invite-'+crypto.createHash('sha256').update(invitation.code).digest('hex')})
  });
  if(!response.ok || (await response.json()).success!==true) throw Error('Email delivery was not confirmed');
}
async function sendApprovalRequest(request,{env=process.env,fetchImpl=fetch}={}) {
  if(!env.PROXY_CLIENT_ID || !env.PROXY_CLIENT_SECRET) throw Error('SMTP client is not configured');
  const response=await fetchImpl('https://oauth.skoonline.org/genai/services/smtp/send',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
    headers:{'Content-Type':'application/json',Authorization:'Basic '+Buffer.from(env.PROXY_CLIENT_ID+':'+env.PROXY_CLIENT_SECRET).toString('base64')},
    body:JSON.stringify({to:'xiangenhu@gmail.com',subject:'Private VPN access request',body:`Verified SKO account ${request.email} requests VPN access.\n\nSign in at ${env.APP_URL} to review the request and issue an invitation code.`,requestId:'vpn-approval-'+crypto.createHash('sha256').update(request.email+':'+request.requestedAt).digest('hex')})
  });
  if(!response.ok || (await response.json()).success!==true) throw Error('Email delivery was not confirmed');
}
module.exports={sendInvitation,sendApprovalRequest};
