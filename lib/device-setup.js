'use strict';
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
  if (!/^[A-Za-z0-9+/]{43}=$/.test(publicKey || '')) throw Error('Unable to read the VPN server identity');
  const peers=lines.filter(Boolean).map(line=>{
    const [pubKey, ipRange, ...extra]=line.trim().split(/\s+/);
    const ip=ipRange?.replace(/\/32$/, '');
    if (!/^[A-Za-z0-9+/]{43}=$/.test(pubKey) || extra.length || ipRange!==ip+'/32' ||
        !ip.startsWith(subnet+'.') || !/^\d+$/.test(ip.slice(subnet.length+1)) ||
        Number(ip.slice(subnet.length+1))<2 || Number(ip.slice(subnet.length+1))>253)
      throw Error('An existing device has an unsupported address; setup stopped to protect it');
    return {pubKey,ip};
  });
  if(new Set(peers.map(p=>p.ip)).size!==peers.length) throw Error('Existing devices have conflicting addresses');
  return {publicKey,peers};
}
function mergeInventory(state, inventory, owner) {
  let imported=0;
  for(const peer of inventory.peers) {
    const known=state.peers.find(p=>p.pubKey===peer.pubKey);
    if(known) {if(known.ip!==peer.ip) throw Error('Device address differs from saved records');continue;}
    if(state.peers.some(p=>p.ip===peer.ip)) throw Error('Device address is already reserved; no devices imported');
    let name='Existing-'+peer.ip.split('.').pop();
    while(state.peers.some(p=>p.name===name)) name+='-imported';
    state.peers.push({...peer,name,owner,imported:true,createdAt:new Date().toISOString()});imported++;
  }
  return imported;
}
module.exports={parseInventory,mergeInventory,vpnEndpoint};
