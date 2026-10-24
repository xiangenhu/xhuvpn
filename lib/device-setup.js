'use strict';
const {AccessError}=require('./access');
function vpnEndpoint(vmHost, configured, portalUrl) {
  const endpoint=(configured || '').trim();
  let portal;
  try {portal=new URL(portalUrl);} catch {}
  // The HTTPS portal is a Cloud Run service, not the WireGuard UDP listener.
  // Reuse the VM already configured for SSH when an old setup used the portal.
  if(!endpoint || (portal && [portal.hostname,portal.origin,portal.origin+'/'].includes(endpoint))) return vmHost;
  return endpoint;
}
function parseInventory(output, subnet) {
  const [publicKey, ...lines] = output.trim().split(/\r?\n/);
  if (!/^[A-Za-z0-9+/]{43}=$/.test(publicKey || '')) throw new AccessError(409,'Unable to read the VPN server identity. The administrator must check the running WireGuard interface. No new profile was created.');
  const peers=lines.filter(Boolean).map(line=>{
    const [pubKey, ipRange, ...extra]=line.trim().split(/\s+/);
    const ip=ipRange?.replace(/\/32$/, '');
    if (!/^[A-Za-z0-9+/]{43}=$/.test(pubKey) || extra.length || ipRange!==ip+'/32' ||
        !ip.startsWith(subnet+'.') || !/^\d+$/.test(ip.slice(subnet.length+1)) ||
        Number(ip.slice(subnet.length+1))<2 || Number(ip.slice(subnet.length+1))>253)
      throw new AccessError(409,'An existing device has an unsupported address; setup stopped to protect it. The administrator must reconcile the server address ranges before profiles can be created.');
    return {pubKey,ip};
  });
  if(new Set(peers.map(p=>p.ip)).size!==peers.length) throw new AccessError(409,'Existing devices have conflicting addresses. The administrator must resolve the server address conflict before profiles can be created.');
  return {publicKey,peers};
}
function mergeInventory(state, inventory, owner) {
  let imported=0;
  for(const peer of inventory.peers) {
    const known=state.peers.find(p=>p.pubKey===peer.pubKey);
    if(known) {if(known.ip!==peer.ip) throw new AccessError(409,'Device address differs from saved records. The administrator must reconcile the portal and WireGuard server records.');continue;}
    if(state.peers.some(p=>p.ip===peer.ip)) throw new AccessError(409,'Device address is already reserved; no devices imported. The administrator must reconcile the portal and WireGuard server records.');
    let name='Existing-'+peer.ip.split('.').pop();
    while(state.peers.some(p=>p.name===name)) name+='-imported';
    state.peers.push({...peer,name,owner,imported:true,createdAt:new Date().toISOString()});imported++;
  }
  return imported;
}
function preserveExistingDevices(state,inventory,administrator) {
  // Preserve manual registrations without transferring ownership to the member
  // enrolling a new device. Never adopt a removed/revoked registration again.
  const peers=inventory.peers.filter(p=>!state.retiredPeerKeys?.[p.pubKey] &&
    (!inventory.managed.has(p.pubKey) || state.peers.some(saved=>saved.pubKey===p.pubKey)));
  return mergeInventory(state,{...inventory,peers},administrator);
}
module.exports={parseInventory,mergeInventory,preserveExistingDevices,vpnEndpoint};
