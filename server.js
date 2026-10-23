#!/usr/bin/env node
/**
 * WireGuard VPN Manager — Cloud Run Edition
 *
 * Storage  : Google Cloud Storage (no local disk writes)
 * Tunneling: WireGuard on a separate GCE VM (applied via SSH)
 * Secrets  : GCP Secret Manager  (SSH key, API secret)
 * Runtime  : Cloud Run (Node.js 20, stateless)
 */

require('dotenv').config();
// Public defaults for this portal; credentials must still come from the runtime.
process.env.APP_URL ??= 'https://vpn.skoonline.org';
process.env.PROXY_CLIENT_ID ??= 'xhuvpn';

const express   = require('express');
const path      = require('path');
const crypto    = require('crypto');
const {parseInventory,mergeInventory,vpnEndpoint}=require('./lib/device-setup');
const {withDeadline}=require('./lib/deadline');
const qrcode    = require('qrcode');
const { NodeSSH } = require('node-ssh');
const { Storage } = require('@google-cloud/storage');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

const app     = express();
const route = handler => (req,res,next) => Promise.resolve(handler(req,res,next)).catch(next);
const storage = new Storage();                          // uses ADC / service account
const secrets = new SecretManagerServiceClient();

app.use(express.json({limit:'16kb'}));
app.use((req,res,next)=>{res.set('Referrer-Policy','no-referrer');next();});
app.use(express.static(path.join(__dirname, 'public')));

// ── Env Config ─────────────────────────────────────────────────────────────
const GCS_BUCKET      = process.env.GCS_BUCKET;        // e.g. my-vpn-data
const GCE_HOST        = process.env.GCE_HOST;          // VM external IP or hostname
const GCE_USER        = process.env.GCE_USER || 'ubuntu';
const WG_INTERFACE    = process.env.WG_INTERFACE || 'wg0';
const SERVER_PORT     = process.env.SERVER_PORT  || 51820;
const SERVER_ENDPOINT = vpnEndpoint(GCE_HOST,process.env.SERVER_ENDPOINT,process.env.APP_URL);
const VPN_SUBNET      = process.env.VPN_SUBNET   || '10.8.0';
const API_PORT        = process.env.PORT          || 8080;  // Cloud Run uses PORT
const GCP_PROJECT     = process.env.GOOGLE_CLOUD_PROJECT;

// Secret Manager resource names (set these env vars to the secret name strings)
const SSH_KEY_SECRET  = process.env.SSH_KEY_SECRET  || 'vpn-ssh-private-key';
const API_KEY_SECRET  = process.env.API_KEY_SECRET  || 'vpn-api-secret';

// OAuth gateway
const OAUTH_GATEWAY   = process.env.OAUTH_GATEWAY || 'https://oauth.skoonline.org';

// ── Secret Manager ─────────────────────────────────────────────────────────
const secretCache = {};

async function getSecret(name) {
  if (secretCache[name]) return secretCache[name];

  // Allow local overrides via env vars (e.g. LOCAL_SECRET_vpn_api_secret)
  const envKey = `LOCAL_SECRET_${name.replace(/-/g, '_')}`;
  if (process.env[envKey]) {
    secretCache[name] = process.env[envKey];
    return secretCache[name];
  }

  const [version] = await secrets.accessSecretVersion({
    name: `projects/${GCP_PROJECT}/secrets/${name}/versions/latest`
  });
  const value = version.payload.data.toString('utf8').trim();
  secretCache[name] = value;
  return value;
}

// ── GCS Helpers ────────────────────────────────────────────────────────────
async function gcsRead(filename) {
  try {
    const [contents] = await storage.bucket(GCS_BUCKET).file(filename).download();
    return JSON.parse(contents.toString('utf8'));
  } catch (e) {
    if (e.code === 404) return null;
    throw e;
  }
}

// Server identity is initialized once, even if two friends enroll concurrently.
async function getOrCreateServerKeys() {
  const existing=await gcsRead('server-keys.json');
  if(existing) return existing;
  if((await readPeers()).length) throw Error('Server keys missing; restore them before provisioning devices');
  const pair=crypto.generateKeyPairSync('x25519');
  const keys={privKey:pair.privateKey.export({format:'der',type:'pkcs8'}).subarray(-32).toString('base64'),pubKey:pair.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64')};
  try {await storage.bucket(GCS_BUCKET).file('server-keys.json').save(JSON.stringify(keys),{resumable:false,preconditionOpts:{ifGenerationMatch:0},metadata:{cacheControl:'no-store'}});}
  catch(e){if(e.code!==412)throw e;return gcsRead('server-keys.json');}
  return keys;
}

async function readPeers() { return (await stateStore.read()).value.peers; }

// ── SSH to GCE VM ──────────────────────────────────────────────────────────
async function connectSSH() {
  let privateKey;
  try {privateKey=await withDeadline(getSecret(SSH_KEY_SECRET),10000);}
  catch {throw new AccessError(503,'Cannot load the VPN server connection key. Administrator: check Secret Manager access for the Cloud Run service.');}
  const ssh = new NodeSSH();
  try {await withDeadline(ssh.connect({
    host:       GCE_HOST,
    username:   GCE_USER,
    privateKey,
    readyTimeout: 10000
  }),15000,()=>ssh.dispose());}
  catch {ssh.dispose();throw new AccessError(503,'Cannot connect to the VPN machine. Administrator: check its address, SSH key, username and firewall.');}
  return ssh;
}

async function runSSH(ssh,command) {
  try {return await withDeadline(ssh.execCommand(command),20000,()=>ssh.dispose());}
  catch {throw new AccessError(503,'The VPN machine did not finish the setup check. Administrator: check WireGuard and password-free sudo access, then retry.');}
}

async function applyWireGuardConfig() {
  const {privKey, pubKey} = await getOrCreateServerKeys();
  const {value, generation} = await stateStore.read();
  // Disabled members are filtered again as defense in depth.
  const peers=value.peers.filter(p=>value.users[p.owner]?.enabled!==false);
  if(![pubKey,...value.peers.map(p=>p.pubKey)].every(k=>/^[A-Za-z0-9+/]{43}=$/.test(k))) throw Error('Invalid saved device key');
  const config=buildServerConfig(privKey,peers);
  if (!/^[A-Za-z0-9_-]{1,15}$/.test(WG_INTERFACE) || !/^\d+$/.test(String(generation))) throw Error('Invalid WireGuard settings');
  const script=`set -euo pipefail
umask 077
mkdir -p /etc/wireguard
exec 9>/etc/wireguard/xhuvpn.lock
flock -x 9
marker=/etc/wireguard/.xhuvpn-generation
previous=$(cat "$marker" 2>/dev/null || echo 0)
if [ "$previous" -gt '${generation}' ]; then exit 0; fi
# Protect devices enrolled outside the dashboard, including the first migration.
if wg show '${WG_INTERFACE}' >/dev/null 2>&1; then
  test "$(wg show '${WG_INTERFACE}' public-key)" = '${pubKey}'
  for peer in $(wg show '${WG_INTERFACE}' peers); do
    if ! printf '%s\\n' '${value.peers.map(p=>p.pubKey).join('\n')}' | grep -Fxq "$peer" && ! grep -Fxq "$peer" /etc/wireguard/.xhuvpn-managed-peers 2>/dev/null; then
      echo 'Import existing devices before synchronization' >&2; exit 1
    fi
  done
fi
file=$(mktemp /etc/wireguard/.xhuvpn.XXXXXX)
trap 'rm -f "$file"' EXIT
printf '%s' '${Buffer.from(config).toString('base64')}' | base64 -d > "$file"
install -m 600 "$file" /etc/wireguard/${WG_INTERFACE}.conf
if wg show '${WG_INTERFACE}' >/dev/null 2>&1; then
  wg-quick strip '${WG_INTERFACE}' > "$file"
  wg syncconf '${WG_INTERFACE}' "$file"
else
  wg-quick up '${WG_INTERFACE}'
fi
printf '%s' '${generation}' > "$marker"
printf '%s\\n' '${peers.map(p=>p.pubKey).join('\n')}' > /etc/wireguard/.xhuvpn-managed-peers
`;
  const ssh=await connectSSH();
  try {
    const result=await runSSH(ssh,"printf '%s' '"+Buffer.from(script).toString('base64')+"' | base64 -d | sudo -n bash");
    if(result.code!==0) throw Error('VPN synchronization failed; retry synchronization from the admin dashboard');
  } finally {ssh.dispose();}
  return pubKey;
}

// ── WireGuard Config Builders ──────────────────────────────────────────────
function buildServerConfig(serverPrivKey, peers) {
  const peerBlocks = peers.map(p => `
[Peer]
# ${p.name}
PublicKey = ${p.pubKey}
AllowedIPs = ${p.ip}/32`).join('\n');

  return `# Auto-generated by vpn-manager — do not edit manually
[Interface]
Address    = ${VPN_SUBNET}.1/24
MTU        = 1380
ListenPort = ${SERVER_PORT}
PrivateKey = ${serverPrivKey}
PostUp     = iptables -A FORWARD -i %i -j ACCEPT; iptables -t nat -A POSTROUTING -o $(ip route | awk '/default/ {print $5}') -j MASQUERADE
PostDown   = iptables -D FORWARD -i %i -j ACCEPT; iptables -t nat -D POSTROUTING -o $(ip route | awk '/default/ {print $5}') -j MASQUERADE
${peerBlocks}
`;
}

function buildClientConfig(clientPrivKey, clientIP, serverPubKey) {
  return `[Interface]
PrivateKey = ${clientPrivKey}
Address    = ${clientIP}/32
DNS        = 1.1.1.1, 8.8.8.8
MTU        = 1380

[Peer]
PublicKey  = ${serverPubKey}
Endpoint   = ${SERVER_ENDPOINT}:${SERVER_PORT}
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
`;
}

function nextClientIP(peers) {
  const used = peers.map(p => parseInt(p.ip.split('.')[3]));
  for (let i = 2; i < 254; i++) {
    if (!used.includes(i)) return `${VPN_SUBNET}.${i}`;
  }
  throw new Error('IP pool exhausted');
}

// Browser sessions and PKCE state are encrypted at rest in the private GCS bucket.
const { createOAuth } = require('./lib/oauth');
const authRecords = {
  async put(name, value) { await storage.bucket(GCS_BUCKET).file(name).save(value, {resumable:false, metadata:{cacheControl:'no-store'}, preconditionOpts:{ifGenerationMatch:0}}); },
  async get(name) { const [data] = await storage.bucket(GCS_BUCKET).file(name).download(); return data.toString(); },
  async take(name) {
    const file = storage.bucket(GCS_BUCKET).file(name);
    const [meta] = await file.getMetadata();
    const [data] = await storage.bucket(GCS_BUCKET).file(name, {generation:meta.generation}).download();
    await file.delete({ifGenerationMatch:meta.generation});
    return data.toString();
  }
};
const {createStateStore}=require('./lib/state-store');
const {createAccess,AccessError}=require('./lib/access');
const stateStore=createStateStore(storage.bucket(GCS_BUCKET));
const remoteBrowser=require('./lib/remote-browser').createRemoteBrowser({store:stateStore});
const NOTICE_VERSION='2026-10-23';
const RESEARCH_NOTICE='This service was created by Xiangen Hu to support his colleagues and research teams for research purposes only. Do not share or distribute access, invitation codes, VPN profiles, or session links without Xiangen Hu’s permission. Users are responsible for their internet activity and any improper use of this service, and must comply with applicable laws and institutional policies.';
const access=createAccess({store:stateStore,origin:process.env.APP_URL});
const oauth = createOAuth({records:authRecords,access});
oauth.mount(app);
const auth = oauth.auth;

// ── Helpers: per-user filtering ───────────────────────────────────────────

function filterPeersForUser(peers, req) {
  if (req.authType === 'admin') return peers;
  return peers.filter(p => p.owner === req.user.email);
}

function canAccessPeer(peer, req) {
  if (req.authType === 'admin') return true;
  return peer.owner === req.user.email;
}

// ── Routes ─────────────────────────────────────────────────────────────────

// GET /api/me — get current user info
const adminOnly=(req,res,next)=>req.authType==='admin' && req.user.email==='xiangenhu@gmail.com'?next():res.status(403).json({error:'Administrator access required'});

async function serverInventory() {
  if(!/^[A-Za-z0-9_-]{1,15}$/.test(WG_INTERFACE)) throw Error('Invalid interface');
  if(!SERVER_ENDPOINT || SERVER_ENDPOINT!==GCE_HOST) throw new AccessError(409,'Set the VPN endpoint to the VPN VM address before adding devices');
  const ssh=await connectSSH();
  try {
    const result=await runSSH(ssh,`test "$(sysctl -n net.ipv4.ip_forward)" = 1 && systemctl is-enabled --quiet wg-quick@${WG_INTERFACE} && sudo -n wg show ${WG_INTERFACE} public-key && sudo -n wg show ${WG_INTERFACE} allowed-ips`);
    if(result.code!==0) throw new AccessError(503,'Server setup needs attention: check WireGuard startup, IP forwarding and password-free sudo access');
    const inventory=parseInventory(result.stdout,VPN_SUBNET);
    const keys=await gcsRead('server-keys.json');
    if(!keys || keys.pubKey!==inventory.publicKey) throw new AccessError(409,'Saved server identity does not match the running VPN. Existing connections have been preserved');
    return inventory;
  } finally {ssh.dispose();}
}
app.post('/api/admin/import-devices',auth,adminOnly,route(async(req,res)=>{
  const inventory=await serverInventory();
  // A peer previously managed then removed must never be adopted back as owner.
  const ssh=await connectSSH();let managed;
  try {
    const result=await runSSH(ssh,"sudo -n sh -c 'if [ -f /etc/wireguard/.xhuvpn-managed-peers ]; then cat /etc/wireguard/.xhuvpn-managed-peers; fi'");
    if(result.code!==0) throw new AccessError(503,'Cannot read prior device registrations; import stopped');
    managed=new Set(result.stdout.trim().split(/\s+/));
  } finally {ssh.dispose();}
  const imported=await stateStore.update(state=>mergeInventory(state,{...inventory,peers:inventory.peers.filter(p=>!managed.has(p.pubKey) || state.peers.some(saved=>saved.pubKey===p.pubKey))},req.user.email));
  await applyWireGuardConfig();
  res.json({imported});
}));
app.get('/api/peers/:name/connection',auth,route(async(req,res)=>{
  const peer=(await readPeers()).find(p=>p.name===req.params.name);
  if(!peer) return res.status(404).json({error:'Device not found'});
  if(!canAccessPeer(peer,req)) return res.status(403).json({error:'Not your device'});
  if(!/^[A-Za-z0-9_-]{1,15}$/.test(WG_INTERFACE)) throw Error('Invalid interface');
  const ssh=await connectSSH();
  try {
    const result=await runSSH(ssh,`sudo -n wg show ${WG_INTERFACE} latest-handshakes`);
    if(result.code!==0) throw Error('Unable to check connection');
    const line=result.stdout.split('\n').find(l=>l.split(/\s+/)[0]===peer.pubKey);
    const timestamp=Number(line?.trim().split(/\s+/)[1]) || 0;
    res.json({recentHandshake:timestamp>0 && Date.now()/1000-timestamp<180,lastHandshake:timestamp || null});
  } finally {ssh.dispose();}
}));

app.get('/api/me', auth, route(async(req, res) => {
  const state=(await stateStore.read()).value;
  res.json({authType:req.authType,user:req.user,notice:RESEARCH_NOTICE,noticeVersion:NOTICE_VERSION,accepted:state.consent?.[req.user.email]?.version===NOTICE_VERSION,browserEnabled:remoteBrowser.enabled});
}));
app.post('/api/consent',auth,route(async(req,res)=>{
  if(req.body.version!==NOTICE_VERSION || req.body.accept!==true) throw new AccessError(400,'Please accept the current research-use notice');
  await stateStore.update(s=>{s.consent ||= {};s.consent[req.user.email]={version:NOTICE_VERSION,acceptedAt:new Date().toISOString()};});
  res.json({accepted:true});
}));
const requireConsent=route(async(req,res,next)=>{
  if((await stateStore.read()).value.consent?.[req.user.email]?.version!==NOTICE_VERSION) throw new AccessError(403,'Accept the research-use notice before using the service');
  next();
});
app.post('/api/browser/start',auth,requireConsent,route(async(req,res)=>res.json(await remoteBrowser.start(req.user.email))));
app.post('/api/browser/status',auth,requireConsent,route(async(req,res)=>res.json(await remoteBrowser.status(req.user.email))));
app.post('/api/browser/stop',auth,route(async(req,res)=>res.json(await remoteBrowser.stop(req.user.email))));
app.post('/api/access/redeem',auth,route(async(req,res)=>{
  await access.redeem(req.user,req.body.code);
  res.json({approved:true});
}));
app.post('/api/access/request',auth,route(async(req,res)=>{
  const request=await access.requestApproval(req.user);
  if(request.alreadyRequested) return res.json({requested:true,emailStatus:'already-requested'});
  let emailStatus='sent';
  try {await require('./lib/smtp').sendApprovalRequest(request);}
  catch {emailStatus='unconfirmed';}
  res.json({requested:true,emailStatus});
}));

app.get('/api/admin/users', auth, adminOnly, route(async (req,res)=>res.json(await access.summary())));
app.post('/api/admin/invitations', auth, adminOnly, route(async (req,res)=>{
  const invitation=await access.invite(req.body.email);
  if(req.body.sendEmail===true) {
    try {await require('./lib/smtp').sendInvitation(invitation);invitation.emailStatus='sent';}
    catch {invitation.emailStatus='unconfirmed';}
  }
  res.status(201).json(invitation);
}));
app.post('/api/admin/users/disable', auth, adminOnly, route(async (req,res)=>{
  await access.disable(req.body.email);
  const outcomes=await Promise.allSettled([remoteBrowser.stop(req.body.email.trim().toLowerCase()),applyWireGuardConfig()]);
  if(outcomes.some(r=>r.status==='rejected')) return res.status(503).json({disabled:true,needsReconcile:true,error:'Portal access revoked. One or more browser/VPN shutdown operations failed. Retry disabling this user; existing connections may remain until cleanup succeeds.'});
  res.json({disabled:true,needsReconcile:false});
}));
app.post('/api/admin/reconcile', auth, adminOnly, route(async (req,res)=>{
  await applyWireGuardConfig();res.json({ok:true});
}));

// GET /api/status
app.get('/api/status', auth, route(async (req, res) => {
  try {
    const ssh    = await connectSSH();
    const result = await runSSH(ssh,`sudo -n wg show ${WG_INTERFACE}`);
    ssh.dispose();
    if(result.code!==0) throw Error('WireGuard is unavailable');
    const peers  = await readPeers();
    const visible = filterPeersForUser(peers, req);
    res.json({ ok: true, interface: WG_INTERFACE, peerCount: visible.length, wg: req.authType === 'admin' ? result.stdout : undefined });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}));

// GET /api/peers
app.get('/api/peers', auth, route(async (req, res) => {
  const peers = await readPeers();
  const visible = filterPeersForUser(peers, req);
  res.json(visible.map(({ privKey, ...safe }) => safe));
}));

// POST /api/peers  { name: "alice" }
app.post('/api/peers', auth, requireConsent, route(async (req, res) => {
  const { name } = req.body;
  if (typeof name !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(name)) return res.status(400).json({ error: 'Use 1–64 letters, numbers, underscores or hyphens for the device name' });
  const inventory=await serverInventory();

  // Generate outside the transaction; reserve quota, name and IP atomically below.
  const privateKey=crypto.generateKeyPairSync('x25519');
  const privKey=privateKey.privateKey.export({format:'der',type:'pkcs8'}).subarray(-32).toString('base64');
  const pubKey=privateKey.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64');
  const {pubKey:serverPubKey}=await getOrCreateServerKeys();
  const owner=req.authType==='user'?req.user.email:(req.body.owner || req.user.email);
  const ip=await stateStore.update(state=>{
    for(const live of inventory.peers) {
      if(!state.peers.some(p=>p.pubKey===live.pubKey && p.ip===live.ip)) throw new AccessError(409,'Administrator: click Import existing devices before adding another device');
    }
    if(req.authType==='user' && !state.users[owner]?.enabled) throw new AccessError(403,'Access revoked');
    if(state.users[owner]?.enabled===false) throw new AccessError(403,'User is disabled');
    if(owner!==req.user.email && !state.users[owner]?.enabled) throw new AccessError(400,'Choose an active invited user');
    if(state.peers.some(p=>p.name===name)) throw new AccessError(409,'Device name already exists');
    if(req.authType==='user' && state.peers.filter(p=>p.owner===owner).length>=3) throw new AccessError(403,'Maximum 3 devices per user');
    const ip=nextClientIP(state.peers);
    state.peers.push({name,ip,pubKey,privKey,owner,createdAt:new Date().toISOString()});
    return ip;
  });
  try {await applyWireGuardConfig();} catch {return res.status(503).json({error:'Device saved, but VPN synchronization failed. Administrator must retry synchronization.',saved:true,needsReconcile:true});}
  const clientConf=buildClientConfig(privKey,ip,serverPubKey);

  const qr = await qrcode.toDataURL(clientConf);
  res.status(201).json({ name, ip, pubKey, config: clientConf, qr });
}));

// DELETE /api/peers/:name
app.delete('/api/peers/:name', auth, route(async (req, res) => {
  await stateStore.update(state=>{
    const peer=state.peers.find(p=>p.name===req.params.name);
    if(!peer) throw new AccessError(404,'Device not found');
    if(!canAccessPeer(peer,req)) throw new AccessError(403,'Not your device');
    state.peers=state.peers.filter(p=>p.name!==req.params.name);
  });
  try {await applyWireGuardConfig();} catch {return res.status(503).json({error:'Device removed from records, but VPN synchronization failed. Retry synchronization.',needsReconcile:true});}
  res.json({ ok: true, removed: req.params.name });
}));

// GET /api/peers/:name/config
app.get('/api/peers/:name/config', auth, requireConsent, route(async (req, res) => {
  const peers = await readPeers();
  const peer  = peers.find(p => p.name === req.params.name);
  if (!peer) return res.status(404).json({ error: 'Peer not found' });
  if (!canAccessPeer(peer, req)) return res.status(403).json({ error: 'Not your peer' });
  if (!peer.privKey) return res.status(409).json({error:'This device was imported from the server. Keep using its existing file. To replace it, remove the device and create a new profile.'});

  const { pubKey: serverPubKey } = await getOrCreateServerKeys();
  const conf = buildClientConfig(peer.privKey, peer.ip, serverPubKey);

  // Return JSON with QR if Accept header wants it, otherwise plain text download
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    const qr = await qrcode.toDataURL(conf);
    return res.json({ name: peer.name, config: conf, qr });
  }

  res.setHeader('Content-Disposition', `attachment; filename="${peer.name}.conf"`);
  res.setHeader('Content-Type', 'text/plain');
  res.send(conf);
}));

// GET /api/download/:platform — serve installers from GCS releases/ folder
// Platforms: exe, msi, dmg, appimage, deb, ios, android
// Files are stored in GCS under releases/ (e.g. releases/WireGuard Manager Setup 1.0.2.exe)
// Also supports hosting WireGuard mobile APK/IPA under releases/ for users behind firewalls
app.get(['/api/download/:platform', '/i/download/:platform'], auth, route(async (req, res) => {
  const platform = req.params.platform.toLowerCase();

  // Map platform to file extension patterns
  const extMap = {
    exe: ['.exe'],
    msi: ['.msi'],
    dmg: ['.dmg'],
    appimage: ['.appimage'],
    deb: ['.deb'],
    ios: ['.ipa'],
    android: ['.apk'],
  };

  const exts = extMap[platform];
  if (!exts) return res.status(400).json({ error: 'Unknown platform. Use: exe, msi, dmg, ios, android' });

  try {
    const [files] = await storage.bucket(GCS_BUCKET).getFiles({ prefix: 'releases/' });
    // Find matching files by extension
    const matches = files.filter(f => {
      const name = f.name.toLowerCase();
      return exts.some(ext => name.endsWith(ext));
    }).sort((a, b) => new Date(b.metadata.updated) - new Date(a.metadata.updated));

    if (!matches.length) return res.status(404).json({ error: `No ${platform} installer available` });

    const file = matches[0];
    const fileName = path.basename(file.name);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    file.createReadStream().pipe(res);
  } catch (e) {
    res.status(500).json({ error: `Download failed: ${e.message}` });
  }
}));

// GET /api/download — list all available installers
app.get(['/api/download', '/i/download'], auth, route(async (req, res) => {
  try {
    const [files] = await storage.bucket(GCS_BUCKET).getFiles({ prefix: 'releases/' });
    const installers = files.map(f => ({
      name: path.basename(f.name),
      size: f.metadata.size,
      updated: f.metadata.updated,
    }));
    res.json({ installers });
  } catch (e) {
    res.json({ installers: [] });
  }
}));

// Health check (Cloud Run requirement) — verifies GCS bucket is reachable
app.get('/health', route(async (req, res) => {
  try {
    const [exists] = await storage.bucket(GCS_BUCKET).exists();
    if (!exists) return res.status(503).json({ ok: false, error: 'GCS bucket not found' });
    res.json({ ok: true, gcs: 'reachable' });
  } catch (e) {
    res.status(503).json({ ok: false, error: `GCS check failed: ${e.message}` });
  }
}));

app.use((error,req,res,next)=>{
  if(res.headersSent) return next(error);
  res.status(error.status || 503).json({error:error instanceof AccessError?error.message:'Operation failed. Please retry; contact the administrator if it persists.'});
});

// ── Start ──────────────────────────────────────────────────────────────────
module.exports = app;
if (require.main === module) app.listen(API_PORT, '0.0.0.0', () => {
  console.log(`VPN Manager (Cloud Run) listening on :${API_PORT}`);
  console.log(`GCS bucket : ${GCS_BUCKET}`);
  console.log(`GCE host   : ${GCE_HOST}`);
  console.log(`WG endpoint: ${SERVER_ENDPOINT}:${SERVER_PORT}`);
});
