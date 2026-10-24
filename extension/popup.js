'use strict';
const api=typeof browser!=='undefined'?browser:chrome;
const el=id=>document.getElementById(id);
let busy=false;
async function update(action='status') {
  if(busy)return;busy=true;el('connect').disabled=true;el('disconnect').disabled=true;
  try {
    const status=await api.runtime.sendMessage({action});
    const active=['connected','expired'].includes(status.mode);
    el('state').textContent=({connected:'Browser connection on',pairing:'Sign in to connect',expired:'Connection expired',off:'Ready when you are'})[status.mode];
    el('description').textContent=({connected:'Your regular web tabs use the research proxy. Disconnect to restore your normal connection.',pairing:'Sign in on the tab that opened. If your VPN access is approved, this browser connects automatically.',expired:'Disconnect, then connect again to renew your access. Browsing stays blocked through the expired proxy until you disconnect.',off:'Sign in with your SKO account. If your VPN access is approved, your browser connects automatically. No configuration file is needed.'})[status.mode];
    el('connect').hidden=active;el('connect').textContent=status.mode==='pairing'?'Reopen sign-in tab':'Sign in & connect';
    el('disconnect').hidden=status.mode==='off';el('disconnect').textContent=active?'Disconnect':'Cancel connection';
    el('code').hidden=true;el('code').textContent='';
    el('message').textContent=status.problem || '';
  }catch {el('message').textContent='Unable to open extension controls. Close and reopen this panel.';}
  finally {busy=false;el('connect').disabled=false;el('disconnect').disabled=false;}
}
el('connect').addEventListener('click',()=>void update('connect'));
el('disconnect').addEventListener('click',()=>void update('disconnect'));
void update();setInterval(()=>void update(),3000);
