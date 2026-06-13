// =============================================================================
// Live Translator Companion – Electron Main Process
// =============================================================================
//
// Manages the system tray and settings window. The WebSocket server and
// audio processing run alongside in the same process.
//
// Usage: npm run electron:start
// =============================================================================

import { app, BrowserWindow, Tray, Menu, nativeImage, screen } from 'electron';
import { join } from 'path';
import { Logger } from '../utils/logger';
import { getConfig, setConfig, setConfigDir } from '../config';
import { createTrayIcon } from './tray-icon';

const logger = new Logger('Electron');

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let serverProcess: any = null;
let isQuitting = false;
let activeStt: any = null; // Reference to the running STT engine for model switching
let wsServerRef: any = null; // Reference to the WebSocket server for restart

// --- Single-instance lock ---------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  logger.info('Another instance is already running. Quitting.');
  app.quit();
}

app.on('second-instance', () => {
  // Another instance tried to launch — show this one's window
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// --- Application Lifecycle --------------------------------------------------

app.whenReady().then(async () => {
  logger.info('Live Translator Companion (Electron) starting...');

  // Initialize data storage
  const userData = app.getPath('userData');
  setConfigDir(userData);
  setDataDir(userData);

  // Auto-download whisper binary
  const whisperOk = await ensureWhisperBinary();
  if (whisperOk) {
    const binPath = getWhisperBinPath();
    if (binPath !== getConfig().whisperExecPath) {
      setConfig({ whisperExecPath: binPath });
    }
  } else {
    sendStatusToRenderer({ stt: 'Whisper binary unavailable' });
  }

  // Restore or auto-select a model
  await ensureDefaultModel();

  // Create system tray icon
  createTray();

  // Create the main window (hidden by default)
  mainWindow = new BrowserWindow({
    width: 420,
    height: 520,
    minWidth: 320,
    minHeight: 400,
    show: false,
    resizable: true,
    title: 'Live Translator Companion',
    icon: join(__dirname, '../../assets/icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, 'preload.js'),
    },
  });

  // Load the server UI
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // Buffer status until the window is ready to receive IPC messages
  let statusBuffer: Record<string, any>[] = [];

  const queuedSendStatus = (partial: Record<string, any>) => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      sendStatusToRenderer(partial);
    } else {
      statusBuffer.push(partial);
    }
  };

  mainWindow.once('ready-to-show', () => {
    if (statusBuffer.length > 0) {
      // Flush real statuses from the already-running server
      for (const s of statusBuffer) sendStatusToRenderer(s);
      statusBuffer = [];
    } else {
      // Server hasn't started yet — send placeholder
      sendStatusToRenderer({
        server: false,
        stt: 'Starting...',
  
        port: getConfig().wsPort,
        ready: false,
      });
    }
    mainWindow?.show();
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  await startBackgroundServer(queuedSendStatus);
});

app.on('window-all-closed', () => {
  // On macOS, Cmd+Q triggers before-quit which sets isQuitting
  if (process.platform !== 'darwin' || isQuitting) {
    app.quit();
  }
});

app.on('will-quit', () => {
  // Final cleanup: destroy tray if still alive
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

app.on('activate', () => {
  // Show window when dock icon is clicked
  mainWindow?.show();
});

// Handle Cmd+Q / Ctrl+Q — set flag so window close isn't intercepted
app.on('before-quit', () => {
  isQuitting = true;
  // Destroy tray icon so it disappears immediately
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

// --- System Tray ------------------------------------------------------------

function createTray(): void {
  // Generate a platform-appropriate tray icon (blue circle with "LT")
  const icon = createTrayIcon();
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Live Translator',
      click: () => mainWindow?.show(),
    },
    {
      label: 'Hide Window',
      click: () => mainWindow?.hide(),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('Live Translator Companion');
  tray.setContextMenu(contextMenu);

  // Left-click toggles window visibility
  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow?.show();
    }
  });

  // On macOS, also show dock icon
  if (process.platform === 'darwin') {
    app.dock?.show();
  }

  logger.info('System tray icon created');
}

// --- IPC to Renderer --------------------------------------------------------

function sendStatusToRenderer(partial: Record<string, any>): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.send('status', partial);
  } catch { /* window not ready */ }
}

// --- Model Management IPC ---------------------------------------------------
import { getFullModelList, downloadModel, deleteModel, switchModel, setDataDir, ensureWhisperBinary, ensureDefaultModel, getWhisperBinPath } from './model-manager';
import { ipcMain } from 'electron';

ipcMain.handle('models:list', async () => {
  return await getFullModelList();
});

ipcMain.handle('models:download', async (_event, name: string) => {
  await downloadModel(name);
  return await getFullModelList();
});

ipcMain.handle('models:delete', async (_event, name: string) => {
  await deleteModel(name);
  return await getFullModelList();
});

ipcMain.handle('models:switch', async (_event, name: string) => {
  try {
    await switchModel(name);
    if (activeStt && typeof activeStt.setModelPath === 'function') {
      sendStatusToRenderer({ stt: 'Loading new model...' });
      await activeStt.setModelPath(getConfig().whisperModelPath);
      sendStatusToRenderer({ stt: activeStt.isReady() ? 'Ready' : 'Unavailable' });
    } else {
      sendStatusToRenderer({ stt: 'Ready (restart needed)' });
    }
  } catch (err) {
    sendStatusToRenderer({ stt: 'Error: ' + (err as Error).message });
  }
  return await getFullModelList();
});

// --- Settings IPC ------------------------------------------------------------
ipcMain.handle('settings:get', async () => {
  return getConfig();
});

ipcMain.handle('settings:update', async (_event, partial: any) => {
  const oldPort = getConfig().wsPort;
  setConfig(partial);

  // If the port or host changed, restart the server
  const needsRestart = (partial.wsPort && partial.wsPort !== oldPort) || partial.wsHost !== undefined;
  if (needsRestart) {
    if (wsServerRef) {
      await wsServerRef.stop();
      wsServerRef = null;
    }
    // Re-import to create fresh instances with the new port
    const { WebSocketServer } = await import('../websocket-server');
    const { WhisperSTT } = await import('../stt/whisper');
    const { Translator } = await import('../translator');
    const config = getConfig();

    const stt = new WhisperSTT({
      execPath: config.whisperExecPath,
      modelPath: config.whisperModelPath,
    });
    const translator = new Translator({
      sourceLanguage: config.sourceLanguage,
      targetLanguage: config.targetLanguage,
    });
    // Reuse the existing STT state without re-initializing
    activeStt = stt;
    await stt.initialize();
    await translator.initialize();

    const newServer = new WebSocketServer({
      wsHost: config.wsHost,
      port: config.wsPort,
      stt,
      translator,
    });
    try {
      await newServer.start();
      wsServerRef = newServer;
      sendStatusToRenderer({ server: true, port: config.wsPort });
      sendStatusToRenderer({ stt: stt.isReady() ? 'Ready' : 'Unavailable' });
      logger.info(`Server restarted on port ${config.wsPort}`);
    } catch (err) {
      sendStatusToRenderer({ error: (err as Error).message });
      logger.error('Failed to restart server:', (err as Error).message);
    }
  }

  return getConfig();
});

// --- Background Server -----

async function startBackgroundServer(
  sendStatus: (partial: Record<string, any>) => void = sendStatusToRenderer
): Promise<void> {
  try {
    const { WebSocketServer } = await import('../websocket-server');
    const { WhisperSTT } = await import('../stt/whisper');
    const { Translator } = await import('../translator');

    const config = getConfig();

    sendStatus({ server: false, stt: 'Initializing...', port: config.wsPort });

    // Check if a model is selected — start server regardless so the popup can connect
    const { existsSync } = await import('fs');
    logger.info(`Model path from config: ${config.whisperModelPath}`);
    if (config.whisperModelPath) logger.info(`Model exists: ${existsSync(config.whisperModelPath)}`);

    const hasModel = config.whisperModelPath && existsSync(config.whisperModelPath);

    const stt = new WhisperSTT({
      execPath: config.whisperExecPath,
      modelPath: config.whisperModelPath,
    });

    const translator = new Translator({
      sourceLanguage: config.sourceLanguage,
      targetLanguage: config.targetLanguage,
    });

    const wsServer = new WebSocketServer({
      wsHost: config.wsHost,
      port: config.wsPort,
      stt,
      translator,
    });

    if (hasModel) {
      await stt.initialize();
      activeStt = stt;
      sendStatus({ stt: stt.isReady() ? 'Ready' : 'Unavailable' });
    } else {
      sendStatus({ stt: 'No model selected — download one from the popup' });
    }

    await translator.initialize();
    sendStatus({ translator: 'Ready' });

    try {
      await wsServer.start();
      wsServerRef = wsServer;
      sendStatus({ server: true, port: config.wsPort });
    } catch (err) {
      sendStatus({ error: (err as Error).message });
      logger.error('Failed to start server:', (err as Error).message);
      // Still mark server as running so the UI doesn't stay stuck
      sendStatus({ server: false, error: (err as Error).message });
    }



    logger.info(`Background server running on ws://127.0.0.1:${config.wsPort}`);

    sendStatus({ ready: true, server: true, stt: stt.isReady() ? 'Ready' : 'Unavailable', port: config.wsPort });
  } catch (err) {
    logger.error('Failed to start background server:', err);
    sendStatus({ error: (err as Error).message });
  }
}

export { mainWindow, sendStatusToRenderer };
