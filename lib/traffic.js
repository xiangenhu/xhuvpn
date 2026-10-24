'use strict';
// wg dump includes private keys: parse in memory and never return raw output.
function parseDump(raw) {
  return raw.trim().split('\n').slice(1).filter(Boolean).map(line=>{
    const c=line.split('\t');
    if(c.length!==8 || !/^[A-Za-z0-9+/]{43}=$/.test(c[0])) throw Error('Invalid WireGuard statistics');
    const [handshake,upload,download]=c.slice(4,7).map(Number);
    if(![handshake,upload,download].every(n=>Number.isSafeInteger(n)&&n>=0)) throw Error('Invalid counters');
    return {key:c[0],handshake,upload,download};
  });
}
function record(state, samples, now=Date.now()) {
  const t=state.traffic ||= {startedAt:now,lastAt:0,peers:{},daily:{}};
  // A transaction retry or simultaneous older sample must not double count.
  if(now<=t.lastAt)return;
  const day=new Date(now).toISOString().slice(0,10);
  const bucket=t.daily[day] ||= {upload:0,download:0};
  for(const s of samples){
    const device=state.peers.find(p=>p.pubKey===s.key);
    const p=t.peers[s.key] ||= {upload:0,download:0};
    p.name=device?.name || p.name || 'Unregistered device';
    p.owner=device?.owner || p.owner || 'Unassigned';
    // First sighting establishes a baseline. Lower counters indicate reset.
    const up=p.rawUpload===undefined?0:s.upload>=p.rawUpload?s.upload-p.rawUpload:s.upload;
    const down=p.rawDownload===undefined?0:s.download>=p.rawDownload?s.download-p.rawDownload:s.download;
    p.upload+=up;p.download+=down;bucket.upload+=up;bucket.download+=down;
    Object.assign(p,{rawUpload:s.upload,rawDownload:s.download,handshake:s.handshake,seenAt:now});
  }
  t.lastAt=now;
  for(const d of Object.keys(t.daily))if(d<new Date(now-366*86400000).toISOString().slice(0,10))delete t.daily[d];
}
function summary(state,now=Date.now()) {
  const t=state.traffic || {peers:{},daily:{}};
  const members={};let upload=0,download=0,activeDevices=0;
  for(const p of Object.values(t.peers)){
    const active=p.seenAt===t.lastAt && p.handshake>0 && now-p.handshake*1000<180000;
    upload+=p.upload;download+=p.download;if(active)activeDevices++;
    const m=members[p.owner] ||= {owner:p.owner,upload:0,download:0,activeDevices:0,devices:[]};
    m.upload+=p.upload;m.download+=p.download;if(active)m.activeDevices++;
    m.devices.push({name:p.name,upload:p.upload,download:p.download,handshake:p.handshake,active});
  }
  const daily=Object.entries(t.daily).sort().map(([date,v])=>({date,...v}));const monthly={};
  for(const d of daily){const m=monthly[d.date.slice(0,7)] ||= {upload:0,download:0};m.upload+=d.upload;m.download+=d.download;}
  return {startedAt:t.startedAt,lastAt:t.lastAt,upload,download,activeDevices,members:Object.values(members),daily,monthly:Object.entries(monthly).map(([date,v])=>({date,...v}))};
}
module.exports={parseDump,record,summary};
