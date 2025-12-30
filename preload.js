const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    checkOfflineCert: () => ipcRenderer.invoke('check-offline-cert'),
    getOfflineCert: () => ipcRenderer.invoke('get-offline-cert'),
    launchApp: () => ipcRenderer.invoke('launch-app'),
    launchAdmin: () => ipcRenderer.invoke('launch-admin'),
    saveOfflineCert: (cert) => ipcRenderer.invoke('save-offline-cert', cert),
    startLocalServer: () => ipcRenderer.invoke('start-local-server'),
    scanHub: () => ipcRenderer.invoke('scan-hub'),
    connectHub: (url) => ipcRenderer.invoke('connect-hub', url),
    activateAdmin: (key) => ipcRenderer.invoke('activate-admin', key),
    getAppVersion: () => ipcRenderer.invoke('get-app-version')
});
