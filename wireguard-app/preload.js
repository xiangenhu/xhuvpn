const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wg', {
  getTunnels:    ()               => ipcRenderer.invoke('get-tunnels'),
  importTunnel:  ()               => ipcRenderer.invoke('import-tunnel'),
  addTunnel:     (name, config)   => ipcRenderer.invoke('add-tunnel', name, config),
  removeTunnel:  (name)           => ipcRenderer.invoke('remove-tunnel', name),
  toggleTunnel:  (name)           => ipcRenderer.invoke('toggle-tunnel', name),
  editTunnel:    (name, config)   => ipcRenderer.invoke('edit-tunnel', name, config),
  getStatus:     (name)           => ipcRenderer.invoke('get-status', name),
  onUpdate:      (cb)             => ipcRenderer.on('tunnels-updated', cb),

  // Server integration
  getServerSettings:  ()           => ipcRenderer.invoke('get-server-settings'),
  saveServerSettings: (url, key)   => ipcRenderer.invoke('save-server-settings', url, key),
  fetchServerPeers:   ()           => ipcRenderer.invoke('fetch-server-peers'),
  fetchServerConfig:  (name)       => ipcRenderer.invoke('fetch-server-config', name),
});
