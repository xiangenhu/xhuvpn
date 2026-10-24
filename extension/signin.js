'use strict';
// Runs only in the portal's isolated extension world. No page message bridge,
// URL-carried verifier, external-message listener, or exported portal cookie.
const extensionAPI=typeof browser!=='undefined'?browser:chrome;
let running=false,finished=false;
function showConnection(message) {
 let banner=document.getElementById('research-extension-connection');
 if(!banner){banner=document.createElement('p');banner.id='research-extension-connection';banner.setAttribute('role','status');banner.style.cssText='position:sticky;top:0;z-index:200;background:#083f38;color:#fff;padding:18px;font:16px/1.5 system-ui;border:2px solid #0dd1ad';document.body.prepend(banner);}
 banner.textContent=message;
}
async function complete() {
 if(running || finished)return;running=true;
 try {
  const request=await extensionAPI.runtime.sendMessage({action:'signInRequest'});
  if(request?.mode==='connected'){finished=true;showConnection('Your browser connection is on. You can close this tab and browse normally.');return;}
  if(request?.mode!=='pairing' || !request.deviceCode)return;
  const response=await fetch('/api/extension/pair/complete',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json','X-VPN-Request':'1'},body:JSON.stringify({deviceCode:request.deviceCode,verifier:request.verifier}),signal:AbortSignal.timeout(10000)});
  if(response.status===401 || response.status===403){showConnection('Sign in below. Once your VPN access is approved and the research-use agreement is accepted, this browser will connect automatically.');return;}
  let data;try {data=await response.json();}catch {throw Error('Connection could not be completed. Please reopen the extension and try again.');}
  if(!response.ok)throw Error(data.error || 'Unable to finish connecting.');
  const result=await extensionAPI.runtime.sendMessage({action:'finishSignIn'});
  if(result?.mode==='connected'){finished=true;showConnection('Your browser connection is on. You can close this tab and browse normally.');}
  else showConnection(result?.problem || 'Finishing your browser connection…');
 }catch(error){showConnection(error.message || 'Unable to finish connecting.');}
 finally {running=false;}
}
void complete();setInterval(()=>void complete(),3000);
