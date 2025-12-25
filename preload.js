const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    checkOfflineCert: () => ipcRenderer.invoke('check-offline-cert'),
    getOfflineCert: () => ipcRenderer.invoke('get-offline-cert'),
    launchApp: () => ipcRenderer.invoke('launch-app'),
    launchAdmin: () => ipcRenderer.invoke('launch-admin'),
    saveOfflineCert: (cert) => ipcRenderer.invoke('save-offline-cert', cert),
    startLocalServer: () => ipcRenderer.invoke('start-local-server')
});
