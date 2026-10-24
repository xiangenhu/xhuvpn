'use strict';
const crypto=require('node:crypto');
async function sendInvitation(invitation,{env=process.env,fetchImpl=fetch}={}) {
  if(!env.PROXY_CLIENT_ID || !env.PROXY_CLIENT_SECRET) throw Error('SMTP client is not configured');
  const response=await fetchImpl('https://oauth.skoonline.org/genai/services/smtp/send',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
    headers:{'Content-Type':'application/json',Authorization:'Basic '+Buffer.from(env.PROXY_CLIENT_ID+':'+env.PROXY_CLIENT_SECRET).toString('base64')},
    body:JSON.stringify({to:invitation.email,subject:'Your VPN access code and connection instructions',body:`Xiangen has approved your VPN access.\n\nYour approved email: ${invitation.email}\nVPN access code: ${invitation.code}\nCode expires: ${invitation.expires}\n\n1. Open ${invitation.url}\n2. Sign in using ${invitation.email}, through Google or your verified SKO email account.\n3. If asked for a VPN access code, paste the code above and choose Verify code & connect. Accept the research-use agreement if shown.\n4. Choose WireGuard configuration file. Open WireGuard, return to the website, and choose WireGuard is open — continue.\n5. Click Prepare my configuration file, then download the .conf file when it is ready.\n6. In WireGuard choose Import tunnel(s) from file, select the downloaded file, then Activate.\n\nOn later visits, activate your saved connection in WireGuard; you do not need another access code. Do not share the code or configuration file. If a file is not ready or an error appears, send the message to xiangenhu@gmail.com.\n\nBrowser extension: use Sign in & connect only when the website reports that the extension service is available.\n\n— Xiangen Hu`,requestId:'vpn-invite-'+crypto.createHash('sha256').update(invitation.code).digest('hex')})
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
