'use strict';
const api=typeof browser!=='undefined'?browser:chrome;
const el=id=>document.getElementById(id);
let busy=false;
async function update(action='status') {
  if(busy)return;busy=true;el('connect').disabled=true;el('disconnect').disabled=true;
  try {
    const status=await api.runtime.sendMessage({action});
    const active=['connected','expired'].includes(status.mode);
    el('state').textContent=({connected:'Browser connection on',pairing:'Approve this browser',expired:'Connection expired',off:'Ready when you are'})[status.mode];
    el('description').textContent=({connected:'Your regular web tabs use the research proxy. Disconnect to restore your normal connection.',pairing:'Sign in on the portal tab. Check that the code below matches, then approve this browser.',expired:'Disconnect, then connect again to renew your access. Browsing stays blocked through the expired proxy until you disconnect.',off:'Connect, sign in with your SKO account, and approve this browser. No WireGuard profile is needed.'})[status.mode];
    el('connect').hidden=active;el('connect').textContent=status.mode==='pairing'?'Reopen approval tab':'Connect';
    el('disconnect').hidden=status.mode==='off';el('disconnect').textContent=active?'Disconnect':'Cancel connection';
    el('code').hidden=!status.userCode;el('code').textContent=status.userCode || '';
    el('message').textContent=status.problem || '';
  }catch {el('message').textContent='Unable to open extension controls. Close and reopen this panel.';}
  finally {busy=false;el('connect').disabled=false;el('disconnect').disabled=false;}
}
el('connect').addEventListener('click',()=>void update('connect'));
el('disconnect').addEventListener('click',()=>void update('disconnect'));
void update();setInterval(()=>void update(),3000);
