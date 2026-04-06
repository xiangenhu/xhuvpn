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

const express   = require('express');
const path      = require('path');
const crypto    = require('crypto');
const qrcode    = require('qrcode');
const { NodeSSH } = require('node-ssh');
const { Storage } = require('@google-cloud/storage');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

const app     = express();
const storage = new Storage();                          // uses ADC / service account
const secrets = new SecretManagerServiceClient();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Env Config ─────────────────────────────────────────────────────────────
const GCS_BUCKET      = process.env.GCS_BUCKET;        // e.g. my-vpn-data
const GCE_HOST        = process.env.GCE_HOST;          // VM external IP or hostname
const GCE_USER        = process.env.GCE_USER || 'ubuntu';
const WG_INTERFACE    = process.env.WG_INTERFACE || 'wg0';
const SERVER_PORT     = process.env.SERVER_PORT  || 51820;
const SERVER_ENDPOINT = process.env.SERVER_ENDPOINT;   // your domain
const VPN_SUBNET      = process.env.VPN_SUBNET   || '10.8.0';
const API_PORT        = process.env.PORT          || 8080;  // Cloud Run uses PORT
const GCP_PROJECT     = process.env.GOOGLE_CLOUD_PROJECT;

// Secret Manager resource names (set these env vars to the secret name strings)
const SSH_KEY_SECRET  = process.env.SSH_KEY_SECRET  || 'vpn-ssh-private-key';
const API_KEY_SECRET  = process.env.API_KEY_SECRET  || 'vpn-api-secret';

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

async function gcsWrite(filename, data) {
  const file = storage.bucket(GCS_BUCKET).file(filename);
  await file.save(JSON.stringify(data, null, 2), {
    contentType: 'application/json',
    metadata: { cacheControl: 'no-store' }
  });
}

// ── Key Management (stored in GCS) ─────────────────────────────────────────
function genKeypairLocal() {
  // wg genkey not available on Cloud Run — use pure-JS WireGuard key gen
  // WireGuard private key = 32 random bytes, clamped per RFC 7748
  const priv = crypto.randomBytes(32);
  priv[0]  &= 248;
  priv[31] &= 127;
  priv[31] |= 64;
  return { privKey: priv.toString('base64') };
  // Note: pubKey derived on the VM side via: echo <privkey> | wg pubkey
}

async function getOrCreateServerKeys() {
  let keys = await gcsRead('server-keys.json');
  if (keys) return keys;

  // First run — generate on VM and store in GCS
  const ssh    = await connectSSH();
  const priv   = (await ssh.execCommand('wg genkey')).stdout.trim();
  const pub    = (await ssh.execCommand(`echo "${priv}" | wg pubkey`)).stdout.trim();
  ssh.dispose();

  keys = { privKey: priv, pubKey: pub };
  await gcsWrite('server-keys.json', keys);
  return keys;
}

async function readPeers() {
  return (await gcsRead('peers.json')) || [];
}

async function writePeers(peers) {
  await gcsWrite('peers.json', peers);
}

// ── SSH to GCE VM ──────────────────────────────────────────────────────────
async function connectSSH() {
  const privateKey = await getSecret(SSH_KEY_SECRET);
  const ssh = new NodeSSH();
  await ssh.connect({
    host:       GCE_HOST,
    username:   GCE_USER,
    privateKey,
    readyTimeout: 10000
  });
  return ssh;
}

async function applyWireGuardConfig() {
  const { privKey: serverPrivKey, pubKey: serverPubKey } = await getOrCreateServerKeys();
  const peers    = await readPeers();
  const confBody = buildServerConfig(serverPrivKey, peers);

  const ssh = await connectSSH();

  // Write config file on VM
  await ssh.execCommand(
    `echo '${confBody.replace(/'/g, "'\\''")}' | sudo tee /etc/wireguard/${WG_INTERFACE}.conf > /dev/null`
  );

  // Hot-reload if interface is up, else bring it up
  const syncResult = await ssh.execCommand(
    `sudo wg syncconf ${WG_INTERFACE} <(sudo wg-quick strip ${WG_INTERFACE}) 2>/dev/null || sudo wg-quick up ${WG_INTERFACE} 2>&1 || true`
  );

  ssh.dispose();
  return serverPubKey;
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
ListenPort = ${SERVER_PORT}
PrivateKey = ${serverPrivKey}
PostUp     = iptables -A FORWARD -i %i -j ACCEPT; iptables -t nat -A POSTROUTING -o ens4 -j MASQUERADE
PostDown   = iptables -D FORWARD -i %i -j ACCEPT; iptables -t nat -D POSTROUTING -o ens4 -j MASQUERADE
${peerBlocks}
`;
}

function buildClientConfig(clientPrivKey, clientIP, serverPubKey) {
  return `[Interface]
PrivateKey = ${clientPrivKey}
Address    = ${clientIP}/24
DNS        = 1.1.1.1, 8.8.8.8

[Peer]
PublicKey  = ${serverPubKey}
Endpoint   = ${SERVER_ENDPOINT}:${SERVER_PORT}
AllowedIPs = 0.0.0.0/1, 128.0.0.0/1, ::/1, 8000::/1
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

// ── Auth Middleware ────────────────────────────────────────────────────────
async function auth(req, res, next) {
  try {
    const token    = req.headers['x-api-key'] || req.query.key;
    const expected = await getSecret(API_KEY_SECRET);
    if (token !== expected) return res.status(401).json({ error: 'Unauthorized' });
    next();
  } catch (e) {
    res.status(500).json({ error: 'Auth service unavailable', detail: e.message });
  }
}

// ── Routes ─────────────────────────────────────────────────────────────────

// GET /api/status
app.get('/api/status', auth, async (req, res) => {
  try {
    const ssh    = await connectSSH();
    const result = await ssh.execCommand(`sudo wg show ${WG_INTERFACE}`);
    ssh.dispose();
    const peers  = await readPeers();
    res.json({ ok: true, interface: WG_INTERFACE, peerCount: peers.length, wg: result.stdout });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/peers
app.get('/api/peers', auth, async (req, res) => {
  const peers = await readPeers();
  res.json(peers.map(({ privKey, ...safe }) => safe));
});

// POST /api/peers  { name: "alice" }
app.post('/api/peers', auth, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  const peers = await readPeers();
  if (peers.find(p => p.name === name))
    return res.status(409).json({ error: 'Peer name already exists' });

  // Generate keypair on GCE VM (has wg available)
  const ssh     = await connectSSH();
  const privKey = (await ssh.execCommand('wg genkey')).stdout.trim();
  const pubKey  = (await ssh.execCommand(`echo "${privKey}" | wg pubkey`)).stdout.trim();
  ssh.dispose();

  const ip          = nextClientIP(peers);
  const { pubKey: serverPubKey } = await getOrCreateServerKeys();
  const clientConf  = buildClientConfig(privKey, ip, serverPubKey);

  peers.push({ name, ip, pubKey, privKey, createdAt: new Date().toISOString() });
  await writePeers(peers);
  await applyWireGuardConfig();

  const qr = await qrcode.toDataURL(clientConf);
  res.status(201).json({ name, ip, pubKey, config: clientConf, qr });
});

// DELETE /api/peers/:name
app.delete('/api/peers/:name', auth, async (req, res) => {
  let peers = await readPeers();
  const before = peers.length;
  peers = peers.filter(p => p.name !== req.params.name);
  if (peers.length === before) return res.status(404).json({ error: 'Peer not found' });

  await writePeers(peers);
  await applyWireGuardConfig();
  res.json({ ok: true, removed: req.params.name });
});

// GET /api/peers/:name/config
app.get('/api/peers/:name/config', auth, async (req, res) => {
  const peers = await readPeers();
  const peer  = peers.find(p => p.name === req.params.name);
  if (!peer) return res.status(404).json({ error: 'Peer not found' });

  const { pubKey: serverPubKey } = await getOrCreateServerKeys();
  const conf = buildClientConfig(peer.privKey, peer.ip, serverPubKey);

  res.setHeader('Content-Disposition', `attachment; filename="${peer.name}.conf"`);
  res.setHeader('Content-Type', 'text/plain');
  res.send(conf);
});

// Health check (Cloud Run requirement) — verifies GCS bucket is reachable
app.get('/health', async (req, res) => {
  try {
    const [exists] = await storage.bucket(GCS_BUCKET).exists();
    if (!exists) return res.status(503).json({ ok: false, error: 'GCS bucket not found' });
    res.json({ ok: true, gcs: 'reachable' });
  } catch (e) {
    res.status(503).json({ ok: false, error: `GCS check failed: ${e.message}` });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(API_PORT, '0.0.0.0', () => {
  console.log(`VPN Manager (Cloud Run) listening on :${API_PORT}`);
  console.log(`GCS bucket : ${GCS_BUCKET}`);
  console.log(`GCE host   : ${GCE_HOST}`);
  console.log(`WG endpoint: ${SERVER_ENDPOINT}:${SERVER_PORT}`);
});
