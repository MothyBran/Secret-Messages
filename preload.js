const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    scanHub: () => ipcRenderer.invoke('scan-hub'),
    getHubConfig: () => ipcRenderer.invoke('get-hub-config')
});

// Preserve existing exposed API if it's being used by legacy code (unlikely in pure webapp context but good for safety)
contextBridge.exposeInMainWorld('electron', {
    scanHub: () => ipcRenderer.invoke('scan-hub')
});
