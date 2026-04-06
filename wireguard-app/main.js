const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs   = require('fs');
const { execFile, exec } = require('child_process');
const Store = require('electron-store');

const store = new Store({ name: 'tunnels' });
const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

let mainWindow;
let tray;
let statusInterval;

// ── Tunnel storage ────────────────────────────────────────────────────────
// Each tunnel: { name, config, active }

function getTunnels() {
  return store.get('tunnels', []);
}

function saveTunnels(tunnels) {
  store.set('tunnels', tunnels);
}

// ── WireGuard helpers ─────────────────────────────────────────────────────

function getConfDir() {
  if (isWin) return 'C:\\Program Files\\WireGuard\\Data\\Configurations';
  if (isMac) return '/usr/local/etc/wireguard';
  return '/etc/wireguard';
}

function writeConfFile(name, config) {
  const dir = getConfDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const confPath = path.join(dir, `${name}.conf`);
  fs.writeFileSync(confPath, config, { mode: 0o600 });
  return confPath;
}

function removeConfFile(name) {
  const confPath = path.join(getConfDir(), `${name}.conf`);
  if (fs.existsSync(confPath)) fs.unlinkSync(confPath);
}

function runCommand(cmd, args = []) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

function runShell(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

async function activateTunnel(name, config) {
  writeConfFile(name, config);

  if (isWin) {
    // Windows: use wireguard.exe /installtunnelservice
    await runCommand('C:\\Program Files\\WireGuard\\wireguard.exe', ['/installtunnelservice', path.join(getConfDir(), `${name}.conf`)]);
  } else {
    await runShell(`sudo wg-quick up ${name}`);
  }
}

async function deactivateTunnel(name) {
  if (isWin) {
    await runCommand('C:\\Program Files\\WireGuard\\wireguard.exe', ['/uninstalltunnelservice', name]);
  } else {
    await runShell(`sudo wg-quick down ${name}`);
  }
  removeConfFile(name);
}

async function getTunnelStatus(name) {
  try {
    let output;
    if (isWin) {
      output = await runShell(`"C:\\Program Files\\WireGuard\\wg.exe" show ${name}`);
    } else {
      output = await runShell(`sudo wg show ${name}`);
    }
    return parseWgShow(output);
  } catch {
    return null;
  }
}

function parseWgShow(output) {
  const stats = {};
  const lines = output.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('endpoint:'))            stats.endpoint = trimmed.split(':').slice(1).join(':').trim();
    if (trimmed.startsWith('latest handshake:'))     stats.handshake = trimmed.replace('latest handshake:', '').trim();
    if (trimmed.startsWith('transfer:'))             stats.transfer = trimmed.replace('transfer:', '').trim();
    if (trimmed.startsWith('allowed ips:'))          stats.allowedIPs = trimmed.replace('allowed ips:', '').trim();
    if (trimmed.startsWith('persistent keepalive:')) stats.keepalive = trimmed.replace('persistent keepalive:', '').trim();
  }
  return stats;
}

// ── IPC handlers ──────────────────────────────────────────────────────────

ipcMain.handle('get-tunnels', () => getTunnels());

ipcMain.handle('import-tunnel', async (_, filePaths) => {
  if (!filePaths) {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import WireGuard Config',
      filters: [{ name: 'WireGuard Config', extensions: ['conf'] }],
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled) return getTunnels();
    filePaths = result.filePaths;
  }

  const tunnels = getTunnels();
  for (const fp of filePaths) {
    const config = fs.readFileSync(fp, 'utf-8');
    const name = path.basename(fp, '.conf').replace(/[^a-zA-Z0-9_-]/g, '_');
    if (!tunnels.find(t => t.name === name)) {
      tunnels.push({ name, config, active: false });
    }
  }
  saveTunnels(tunnels);
  return tunnels;
});

ipcMain.handle('add-tunnel', (_, name, config) => {
  const tunnels = getTunnels();
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (tunnels.find(t => t.name === safeName)) {
    throw new Error(`Tunnel "${safeName}" already exists`);
  }
  tunnels.push({ name: safeName, config, active: false });
  saveTunnels(tunnels);
  return tunnels;
});

ipcMain.handle('remove-tunnel', async (_, name) => {
  let tunnels = getTunnels();
  const tunnel = tunnels.find(t => t.name === name);
  if (tunnel?.active) {
    try { await deactivateTunnel(name); } catch {}
  }
  tunnels = tunnels.filter(t => t.name !== name);
  saveTunnels(tunnels);
  return tunnels;
});

ipcMain.handle('toggle-tunnel', async (_, name) => {
  const tunnels = getTunnels();
  const tunnel = tunnels.find(t => t.name === name);
  if (!tunnel) throw new Error('Tunnel not found');

  if (tunnel.active) {
    await deactivateTunnel(name);
    tunnel.active = false;
  } else {
    // Deactivate any other active tunnel first
    for (const t of tunnels) {
      if (t.active) {
        try {
          await deactivateTunnel(t.name);
          t.active = false;
        } catch {}
      }
    }
    await activateTunnel(name, tunnel.config);
    tunnel.active = true;
  }
  saveTunnels(tunnels);
  updateTrayMenu();
  return tunnels;
});

ipcMain.handle('get-status', async (_, name) => {
  return await getTunnelStatus(name);
});

// ── Server integration (fetch configs from VPN Manager) ───────────────

ipcMain.handle('get-server-settings', () => {
  return store.get('server', { url: '', apiKey: '' });
});

ipcMain.handle('save-server-settings', (_, url, apiKey) => {
  store.set('server', { url: url.replace(/\/+$/, ''), apiKey });
});

ipcMain.handle('fetch-server-peers', async () => {
  const { url, apiKey } = store.get('server', {});
  if (!url || !apiKey) throw new Error('Server not configured. Go to Settings first.');

  const res = await fetch(`${url}/api/peers`, {
    headers: { 'x-api-key': apiKey },
  });
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  return await res.json();
});

ipcMain.handle('fetch-server-config', async (_, peerName) => {
  const { url, apiKey } = store.get('server', {});
  if (!url || !apiKey) throw new Error('Server not configured');

  const res = await fetch(`${url}/api/peers/${encodeURIComponent(peerName)}/config`, {
    headers: { 'x-api-key': apiKey },
  });
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  const config = await res.text();

  // Auto-import as a tunnel
  const tunnels = getTunnels();
  const existing = tunnels.find(t => t.name === peerName);
  if (existing) {
    existing.config = config;
  } else {
    tunnels.push({ name: peerName, config, active: false });
  }
  saveTunnels(tunnels);
  return tunnels;
});

ipcMain.handle('edit-tunnel', (_, name, config) => {
  const tunnels = getTunnels();
  const tunnel = tunnels.find(t => t.name === name);
  if (!tunnel) throw new Error('Tunnel not found');
  if (tunnel.active) throw new Error('Disconnect before editing');
  tunnel.config = config;
  saveTunnels(tunnels);
  return tunnels;
});

// ── Tray ──────────────────────────────────────────────────────────────────

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  let icon;
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
  } else {
    // Fallback: 16x16 empty icon
    icon = nativeImage.createEmpty();
  }
  tray = new Tray(icon.isEmpty() ? createDefaultIcon() : icon);
  tray.setToolTip('WireGuard Manager');
  tray.on('click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
  updateTrayMenu();
}

function createDefaultIcon() {
  // Generate a simple 16x16 icon programmatically
  const size = 16;
  const canvas = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    canvas[i * 4]     = 88;   // R
    canvas[i * 4 + 1] = 166;  // G
    canvas[i * 4 + 2] = 255;  // B
    canvas[i * 4 + 3] = 255;  // A
  }
  return nativeImage.createFromBuffer(canvas, { width: size, height: size });
}

function updateTrayMenu() {
  if (!tray) return;
  const tunnels = getTunnels();
  const tunnelItems = tunnels.map(t => ({
    label: `${t.active ? '● ' : '○ '}${t.name}`,
    click: async () => {
      try {
        await ipcMain.emit('toggle-tunnel', null, t.name);
      } catch {}
      mainWindow?.webContents.send('tunnels-updated');
    }
  }));

  const menu = Menu.buildFromTemplate([
    ...tunnelItems,
    { type: 'separator' },
    { label: 'Show Window', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}

// ── Window ────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 640,
    minWidth: 400,
    minHeight: 500,
    title: 'WireGuard Manager',
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  // Poll status for active tunnels
  statusInterval = setInterval(() => {
    mainWindow?.webContents.send('tunnels-updated');
  }, 5000);
}

// ── App lifecycle ─────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on('before-quit', async () => {
  clearInterval(statusInterval);
  // Deactivate all tunnels on quit
  const tunnels = getTunnels();
  for (const t of tunnels) {
    if (t.active) {
      try { await deactivateTunnel(t.name); } catch {}
      t.active = false;
    }
  }
  saveTunnels(tunnels);
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

app.on('activate', () => {
  mainWindow?.show();
});
