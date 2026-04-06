const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let tunnels = [];
let selectedTunnel = null;

// ── Render ────────────────────────────────────────────────────────────────

function render() {
  const list = $('#tunnel-list');

  if (tunnels.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
        <p>No tunnels configured</p>
        <p class="hint">Import a .conf file or add a tunnel manually</p>
      </div>`;
    return;
  }

  list.innerHTML = tunnels.map(t => `
    <div class="tunnel-card ${t.active ? 'active' : ''}" data-name="${t.name}">
      <div class="tunnel-indicator"></div>
      <div class="tunnel-info">
        <div class="tunnel-name">${t.name}</div>
        <div class="tunnel-meta">${t.active ? 'Connected' : 'Inactive'}</div>
      </div>
      <div class="tunnel-actions">
        <button class="btn-icon btn-edit" data-name="${t.name}" title="Edit">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="btn-icon btn-danger btn-delete" data-name="${t.name}" title="Remove">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
          </svg>
        </button>
        <label class="toggle-switch">
          <input type="checkbox" ${t.active ? 'checked' : ''} data-name="${t.name}">
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>`).join('');
}

// ── Load tunnels ──────────────────────────────────────────────────────────

async function loadTunnels() {
  tunnels = await wg.getTunnels();
  render();
  refreshStatus();
}

// ── Status refresh ────────────────────────────────────────────────────────

async function refreshStatus() {
  if (!selectedTunnel) return;
  const t = tunnels.find(t => t.name === selectedTunnel);
  if (!t || !t.active) {
    $('#stat-status').textContent = t ? 'Inactive' : '--';
    $('#stat-endpoint').textContent = '--';
    $('#stat-transfer').textContent = '--';
    $('#stat-handshake').textContent = '--';
    $('#stat-allowed').textContent = '--';
    return;
  }

  const status = await wg.getStatus(selectedTunnel);
  if (status) {
    $('#stat-status').textContent = 'Connected';
    $('#stat-status').style.color = 'var(--green)';
    $('#stat-endpoint').textContent = status.endpoint || '--';
    $('#stat-transfer').textContent = status.transfer || '--';
    $('#stat-handshake').textContent = status.handshake || '--';
    $('#stat-allowed').textContent = status.allowedIPs || '--';
  } else {
    $('#stat-status').textContent = 'Connecting...';
    $('#stat-status').style.color = 'var(--orange)';
  }
}

// ── Event: Toggle tunnel ──────────────────────────────────────────────────

$('#tunnel-list').addEventListener('change', async (e) => {
  if (!e.target.matches('.toggle-switch input')) return;
  const name = e.target.dataset.name;
  const card = e.target.closest('.tunnel-card');

  card.classList.add('loading');
  try {
    tunnels = await wg.toggleTunnel(name);
    render();
    refreshStatus();
  } catch (err) {
    alert(`Failed to toggle tunnel: ${err.message}`);
    render();
  }
});

// ── Event: Click card to show status ──────────────────────────────────────

$('#tunnel-list').addEventListener('click', (e) => {
  const card = e.target.closest('.tunnel-card');
  if (!card) return;
  // Ignore if clicking action buttons
  if (e.target.closest('.tunnel-actions')) return;

  const name = card.dataset.name;
  selectedTunnel = name;
  $('#status-name').textContent = name;
  $('#status-panel').classList.remove('hidden');
  refreshStatus();
});

// ── Event: Delete tunnel ──────────────────────────────────────────────────

$('#tunnel-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('.btn-delete');
  if (!btn) return;
  e.stopPropagation();
  const name = btn.dataset.name;
  if (!confirm(`Remove tunnel "${name}"?`)) return;
  tunnels = await wg.removeTunnel(name);
  if (selectedTunnel === name) {
    selectedTunnel = null;
    $('#status-panel').classList.add('hidden');
  }
  render();
});

// ── Event: Edit tunnel ────────────────────────────────────────────────────

$('#tunnel-list').addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-edit');
  if (!btn) return;
  e.stopPropagation();
  const name = btn.dataset.name;
  const t = tunnels.find(t => t.name === name);
  if (!t) return;

  $('#modal-title').textContent = 'Edit Tunnel';
  $('#tunnel-name').value = t.name;
  $('#tunnel-name').disabled = true;
  $('#tunnel-config').value = t.config;
  $('#modal').classList.remove('hidden');
  $('#modal').dataset.mode = 'edit';
  $('#modal').dataset.editName = name;
});

// ── Import ────────────────────────────────────────────────────────────────

$('#btn-import').addEventListener('click', async () => {
  tunnels = await wg.importTunnel();
  render();
});

// ── Add (open modal) ──────────────────────────────────────────────────────

$('#btn-add').addEventListener('click', () => {
  $('#modal-title').textContent = 'Add Tunnel';
  $('#tunnel-name').value = '';
  $('#tunnel-name').disabled = false;
  $('#tunnel-config').value = '';
  $('#modal').classList.remove('hidden');
  $('#modal').dataset.mode = 'add';
  $('#tunnel-name').focus();
});

// ── Modal: Save ───────────────────────────────────────────────────────────

$('#btn-modal-save').addEventListener('click', async () => {
  const name   = $('#tunnel-name').value.trim();
  const config = $('#tunnel-config').value.trim();
  const mode   = $('#modal').dataset.mode;

  if (!name || !config) {
    alert('Name and configuration are required.');
    return;
  }

  try {
    if (mode === 'edit') {
      tunnels = await wg.editTunnel($('#modal').dataset.editName, config);
    } else {
      tunnels = await wg.addTunnel(name, config);
    }
    $('#modal').classList.add('hidden');
    render();
  } catch (err) {
    alert(err.message);
  }
});

// ── Modal: Cancel ─────────────────────────────────────────────────────────

$('#btn-modal-cancel').addEventListener('click', () => {
  $('#modal').classList.add('hidden');
});

$('.modal-backdrop').addEventListener('click', () => {
  $('#modal').classList.add('hidden');
});

// ── Status panel: Close ───────────────────────────────────────────────────

$('#btn-status-close').addEventListener('click', () => {
  selectedTunnel = null;
  $('#status-panel').classList.add('hidden');
});

// ── Server Settings ───────────────────────────────────────────────────────

$('#btn-settings').addEventListener('click', async () => {
  const settings = await wg.getServerSettings();
  $('#server-url').value = settings.url || '';
  $('#server-key').value = settings.apiKey || '';
  $('#settings-modal').classList.remove('hidden');
  $('#server-url').focus();
});

$('#btn-settings-save').addEventListener('click', async () => {
  const url = $('#server-url').value.trim();
  const key = $('#server-key').value.trim();
  if (!url || !key) { alert('Both fields are required.'); return; }
  await wg.saveServerSettings(url, key);
  $('#settings-modal').classList.add('hidden');
});

$('#btn-settings-cancel').addEventListener('click', () => {
  $('#settings-modal').classList.add('hidden');
});

$('#settings-modal .modal-backdrop').addEventListener('click', () => {
  $('#settings-modal').classList.add('hidden');
});

// ── Fetch from Server ─────────────────────────────────────────────────────

$('#btn-fetch').addEventListener('click', async () => {
  $('#fetch-modal').classList.remove('hidden');
  $('#fetch-loading').style.display = 'block';
  $('#fetch-list').innerHTML = '';

  try {
    const peers = await wg.fetchServerPeers();
    $('#fetch-loading').style.display = 'none';

    if (peers.length === 0) {
      $('#fetch-list').innerHTML = '<p style="text-align:center;color:var(--text-dim)">No peers on server</p>';
      return;
    }

    $('#fetch-list').innerHTML = peers.map(p => `
      <div class="fetch-peer">
        <div>
          <div class="fetch-peer-name">${p.name}</div>
          <div class="fetch-peer-ip">${p.ip}</div>
        </div>
        <button class="btn btn-primary btn-fetch-peer" data-name="${p.name}">Import</button>
      </div>
    `).join('');
  } catch (err) {
    $('#fetch-loading').style.display = 'none';
    $('#fetch-list').innerHTML = `<p style="text-align:center;color:var(--red)">${err.message}</p>`;
  }
});

$('#fetch-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('.btn-fetch-peer');
  if (!btn) return;
  const name = btn.dataset.name;
  btn.textContent = '...';
  btn.disabled = true;
  try {
    tunnels = await wg.fetchServerConfig(name);
    btn.textContent = 'Done';
    btn.classList.remove('btn-primary');
    render();
  } catch (err) {
    btn.textContent = 'Error';
    alert(err.message);
  }
});

$('#btn-fetch-close').addEventListener('click', () => {
  $('#fetch-modal').classList.add('hidden');
});

$('#fetch-modal .modal-backdrop').addEventListener('click', () => {
  $('#fetch-modal').classList.add('hidden');
});

// ── Keyboard shortcuts ────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    for (const id of ['#settings-modal', '#fetch-modal', '#modal']) {
      if (!$(id).classList.contains('hidden')) {
        $(id).classList.add('hidden');
        return;
      }
    }
    if (selectedTunnel) {
      selectedTunnel = null;
      $('#status-panel').classList.add('hidden');
    }
  }
});

// ── Listen for background updates from main process ───────────────────────

wg.onUpdate(async () => {
  tunnels = await wg.getTunnels();
  render();
  refreshStatus();
});

// ── Init ──────────────────────────────────────────────────────────────────

async function init() {
  await loadTunnels();
  // Auto-fetch peers from server on first launch if no tunnels exist
  if (tunnels.length === 0) {
    try {
      const peers = await wg.fetchServerPeers();
      for (const p of peers) {
        try {
          tunnels = await wg.fetchServerConfig(p.name);
        } catch {}
      }
      render();
    } catch {}
  }
}

init();
