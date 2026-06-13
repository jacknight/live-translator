// =============================================================================
// Live Translator Companion – Preload Script (context bridge)
// =============================================================================

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Server control
  startServer: () => ipcRenderer.invoke('server:start'),
  stopServer: () => ipcRenderer.invoke('server:stop'),
  getServerStatus: () => ipcRenderer.invoke('server:status'),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (settings: any) => ipcRenderer.invoke('settings:update', settings),

  // Model management
  getModels: () => ipcRenderer.invoke('models:list'),
  downloadModel: (name: string) => ipcRenderer.invoke('models:download', name),
  deleteModel: (name: string) => ipcRenderer.invoke('models:delete', name),
  switchModel: (name: string) => ipcRenderer.invoke('models:switch', name),

  // Status updates
  onStatus: (callback: (status: any) => void) => {
    ipcRenderer.on('status', (_event, data) => callback(data));
  },
});
