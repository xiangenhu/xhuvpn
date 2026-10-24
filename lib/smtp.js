'use strict';
const crypto=require('node:crypto');
const MAIL_ERRORS={
 smtp_credentials:'VPN SMTP client credentials are missing.',
 service_scope:'Enable SMTP permission for the VPN client in the OAuth gateway.',
 smtp_setup:'Configure the email sender in the OAuth gateway.',
 smtp_limit:'The VPN client hourly email quota has been reached.',
 email_uncertain:'The gateway could not confirm delivery. Check the recipient inbox and gateway email records before resending.',
 request_id_conflict:'The gateway rejected a reused email request identifier.',
 smtp_auth:'The gateway rejected the VPN client credentials. Check the matching client secret on both services.',
 smtp_unavailable:'The email gateway could not be reached or returned an unexpected response. Delivery is unconfirmed.'
};
function mailError(code,status) {
 const known=Object.hasOwn(MAIL_ERRORS,code)?code:status===401?'smtp_auth':'smtp_unavailable';
 return Object.assign(Error(MAIL_ERRORS[known]),{code:known,status:Number.isInteger(status)?status:null});
}
async function confirmDelivery(response) {
 let data;try {data=await response.json();}catch {throw mailError('smtp_unavailable',response.status);}
 if(!response.ok || data.success!==true) throw mailError(data.code,response.status);
}
function deliveryFailure(error) {
 const safe=mailError(error?.code,error?.status);
 console.warn('VPN email not confirmed',{code:safe.code,status:safe.status});
 return {emailStatus:'unconfirmed',emailError:safe.message,emailCode:safe.code};
}
async function sendInvitation(invitation,{env=process.env,fetchImpl=fetch}={}) {
  if(!env.PROXY_CLIENT_ID || !env.PROXY_CLIENT_SECRET) throw mailError('smtp_credentials');
  const response=await fetchImpl('https://oauth.skoonline.org/genai/services/smtp/send',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
    headers:{'Content-Type':'application/json',Authorization:'Basic '+Buffer.from(env.PROXY_CLIENT_ID+':'+env.PROXY_CLIENT_SECRET).toString('base64')},
    body:JSON.stringify({to:invitation.email,subject:'Your VPN access code and connection instructions',body:`Xiangen has approved your VPN access.\n\nYour approved email: ${invitation.email}\nVPN access code: ${invitation.code}\nCode expires: ${invitation.expires}\n\n1. Open ${invitation.url}\n2. Sign in using ${invitation.email}, through Google or your verified SKO email account.\n3. If asked for a VPN access code, paste the code above and choose Verify code & connect. Accept the research-use agreement if shown.\n4. If needed, install WireGuard from https://www.wireguard.com/install/ . Open WireGuard, return to the website, and choose WireGuard is open — continue.\n5. Click Prepare my configuration file, then download the .conf file when it is ready.\n6. In WireGuard choose Import tunnel(s) from file (or Add tunnel → Import tunnel(s) from file), select the downloaded file, then Activate. On a phone, use WireGuard’s + button to import the file or scan the QR code shown on the website.\n\nCannot find the file? Check your browser’s Downloads list (Ctrl+J on Windows), then Show in folder. The configuration file ends in .conf.\n\nOn later visits, activate your saved connection in WireGuard; you do not need another access code or website sign-in. Use Deactivate in WireGuard to turn the VPN off. Signing out of the website does not turn it off. Do not share the code or configuration file. If a file is not ready or an error appears, send the message to xiangenhu@gmail.com.\n\n— Xiangen Hu`,requestId:'vpn-invite-'+crypto.createHash('sha256').update(invitation.code).digest('hex')})
  });
  await confirmDelivery(response);
}
async function sendApprovalRequest(request,{env=process.env,fetchImpl=fetch}={}) {
  if(!env.PROXY_CLIENT_ID || !env.PROXY_CLIENT_SECRET) throw mailError('smtp_credentials');
  const response=await fetchImpl('https://oauth.skoonline.org/genai/services/smtp/send',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
    headers:{'Content-Type':'application/json',Authorization:'Basic '+Buffer.from(env.PROXY_CLIENT_ID+':'+env.PROXY_CLIENT_SECRET).toString('base64')},
    body:JSON.stringify({to:'xiangenhu@gmail.com',subject:'Private VPN access request',body:`Verified SKO account ${request.email} requests VPN access.\n\nSign in at ${env.APP_URL} to review the request and issue an invitation code.`,requestId:'vpn-approval-'+crypto.createHash('sha256').update(request.email+':'+request.requestedAt).digest('hex')})
  });
  await confirmDelivery(response);
}
module.exports={sendInvitation,sendApprovalRequest,deliveryFailure};
