// =============================================================================
// Live Translator – Background Service Worker
// =============================================================================
//
// Responsibilities:
//   1. Capture tab audio via chrome.tabCapture (or browser.tabCapture)
//   2. Stream audio chunks to companion app over WebSocket
//   3. Receive transcribed & translated text back
//   4. Relay captions to content scripts (video overlay) or open floating window
// =============================================================================

const DEFAULTS = {
  serverAddress: 'ws://127.0.0.1:9876',
  targetLanguage: 'en',
  sourceLanguage: 'auto',
  captionMode: 'auto',      // 'auto' | 'video' | 'floating'
  opacity: 0.9,
  fontSize: 24,
  reconnectDelay: 3000,
};

// --- State -------------------------------------------------------------------
let state = {
  isCapturing: false,
  ws: null,
  mediaStream: null,
  reconnectTimer: null,
  tabId: null,
  settings: { ...DEFAULTS },
  captionContainerId: 'live-translator-captions',
};

// --- Polyfill browser API ----------------------------------------------------
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

// --- WebSocket Manager -------------------------------------------------------
function connectWebSocket() {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) return;

  const addr = state.settings.serverAddress;

  try {
    state.ws = new WebSocket(addr);
  } catch (err) {
    console.error('[Live Translator] WebSocket connection failed:', err);
    scheduleReconnect();
    return;
  }

  state.ws.onopen = () => {
    console.log('[Live Translator] Connected to companion app at', addr);
    clearTimeout(state.reconnectTimer);

    // Send initial config
    sendMessage({
      type: 'config',
      sourceLanguage: state.settings.sourceLanguage,
      targetLanguage: state.settings.targetLanguage,
    });
  };

  state.ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleServerMessage(msg);
    } catch (err) {
      console.warn('[Live Translator] Invalid message from server:', err);
    }
  };

  state.ws.onclose = () => {
    console.log('[Live Translator] WebSocket closed');
    state.ws = null;
    if (state.isCapturing) {
      scheduleReconnect();
    }
  };

  state.ws.onerror = (err) => {
    console.error('[Live Translator] WebSocket error:', err);
    state.ws?.close();
  };
}

function scheduleReconnect() {
  if (state.reconnectTimer) return;
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    if (state.isCapturing) connectWebSocket();
  }, state.settings.reconnectDelay);
}

function sendMessage(msg) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(msg));
  }
}

// --- Audio Capture -----------------------------------------------------------
async function startCapture(tabId) {
  if (state.isCapturing) {
    console.warn('[Live Translator] Already capturing');
    return;
  }

  state.tabId = tabId;

  try {
    const constraints = {
      audio: true,
      video: false,
      audioConstraints: {
        echoCancellation: false,
        noiseSuppression: false,
        sampleRate: 16000,
      },
    };

    state.mediaStream = await new Promise((resolve, reject) => {
      // Detect available API:
      //   Chrome:             chrome.tabCapture.capture(constraints, callback)
      //   Firefox (tabCapture): browser.tabCapture.capture(constraints) → Promise
      //   Firefox (displayMedia): navigator.mediaDevices.getDisplayMedia({ audio: true })
      //   Fallback:           navigator.mediaDevices.getUserMedia (mic)

      if (chrome && chrome.tabCapture) {
        // Chrome: callback-based API
        chrome.tabCapture.capture(constraints, (stream) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (!stream) {
            reject(new Error('No audio stream returned'));
          } else {
            resolve(stream);
          }
        });
      } else if (typeof browser !== 'undefined' && browser.tabCapture) {
        // Firefox with tabCapture support (older builds, or if re-enabled)
        browser.tabCapture.capture(constraints).then(resolve).catch(reject);
      } else {
        // Firefox without tabCapture: popup handles capture via getDisplayMedia
        reject(new Error('FIREFOX_POPUP_CAPTURE'));
      }
    });

    state.isCapturing = true;

    // Connect WebSocket if not already connected
    connectWebSocket();

    // Start streaming audio
    streamAudio(state.mediaStream);

    // Notify content script to prepare captions
    notifyContentScript('START_CAPTIONS', { tabId });

    // Update popup if open
    notifyPopup({ type: 'captureStatus', active: true });

    console.log('[Live Translator] Audio capture started for tab', tabId);
  } catch (err) {
    console.error('[Live Translator] Failed to start capture:', err);
    state.isCapturing = false;
    notifyPopup({ type: 'captureStatus', active: false, error: err.message });
    throw err;
  }
}

function stopCapture() {
  if (!state.isCapturing) return;

  // Stop media stream
  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach((track) => track.stop());
    state.mediaStream = null;
  }

  // Close WebSocket
  if (state.ws) {
    sendMessage({ type: 'stop' });
    state.ws.close();
    state.ws = null;
  }

  state.isCapturing = false;
  state.tabId = null;
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;

  // Notify content script to hide captions
  notifyContentScript('STOP_CAPTIONS', {});

  // Update popup
  notifyPopup({ type: 'captureStatus', active: false });

  console.log('[Live Translator] Audio capture stopped');
}

function streamAudio(stream) {
  // Use AudioContext to convert stream to PCM data
  const audioCtx = new AudioContext({ sampleRate: 16000 });
  const ctxRate = audioCtx.sampleRate;
  const source = audioCtx.createMediaStreamSource(stream);
  const processor = audioCtx.createScriptProcessor(4096, 1, 1);

  source.connect(processor);
  processor.connect(audioCtx.destination);

  processor.onaudioprocess = (event) => {
    if (!state.isCapturing || !state.ws || state.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const inputData = event.inputBuffer.getChannelData(0);

    // Convert Float32 to Int16 PCM
    const pcmData = new Int16Array(inputData.length);
    for (let i = 0; i < inputData.length; i++) {
      const s = Math.max(-1, Math.min(1, inputData[i]));
      pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    // Send raw PCM audio to companion app
    // Binary message: first 4 bytes = sample rate (Uint32), rest = PCM data
    const header = new Uint32Array([ctxRate]);
    const message = new Uint8Array(header.buffer.byteLength + pcmData.buffer.byteLength);
    message.set(new Uint8Array(header.buffer), 0);
    message.set(new Uint8Array(pcmData.buffer), header.buffer.byteLength);

    state.ws.send(message.buffer);
  };
}

// --- Message Handling --------------------------------------------------------
function handleServerMessage(msg) {
  switch (msg.type) {
    case 'transcription':
      // Partial or final transcription
      notifyContentScript('TRANSCRIPTION', {
        original: msg.text,
        translated: msg.translated,
        isFinal: msg.isFinal || false,
      });
      break;

    case 'translation':
      // Final translated text
      notifyContentScript('TRANSLATION', {
        text: msg.text,
        sourceLanguage: msg.sourceLanguage,
        targetLanguage: msg.targetLanguage,
      });
      break;

    case 'error':
      console.error('[Live Translator] Server error:', msg.message);
      notifyPopup({ type: 'error', message: msg.message });
      break;

    case 'status':
      // Server status update
      notifyPopup({ type: 'status', ...msg });
      break;

    default:
      console.warn('[Live Translator] Unknown message type:', msg.type);
  }
}

// --- Cross-context Communication ---------------------------------------------
function notifyContentScript(action, data) {
  const message = { action, data, containerId: state.captionContainerId };

  // Send to all tabs (content scripts listen for this)
  browserAPI.tabs?.query({}, (tabs) => {
    tabs.forEach((tab) => {
      browserAPI.tabs.sendMessage(tab.id, message).catch(() => {
        // Ignore errors from tabs without content script
      });
    });
  });
}

function notifyPopup(data) {
  browserAPI.runtime.sendMessage({ type: 'popupUpdate', data }).catch(() => {
    // Popup may not be open
  });
}

// --- Settings ----------------------------------------------------------------
function loadSettings() {
  return new Promise((resolve) => {
    browserAPI.storage.local.get('settings', (result) => {
      if (result.settings) {
        state.settings = { ...DEFAULTS, ...result.settings };
      }
      resolve(state.settings);
    });
  });
}

function saveSettings(settings) {
  state.settings = { ...state.settings, ...settings };
  browserAPI.storage.local.set({ settings: state.settings });

  // If capturing, send updated config to server
  if (state.isCapturing && state.ws) {
    sendMessage({
      type: 'config',
      sourceLanguage: state.settings.sourceLanguage,
      targetLanguage: state.settings.targetLanguage,
    });
  }
}

// --- Message Listeners -------------------------------------------------------
browserAPI.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    case 'startCapture':
      startCapture(request.tabId || sender.tab?.id)
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true; // Keep channel open for async response

    case 'notifyCapture':
      // Firefox content-script capture — track it so popup shows correct status
      state.isCapturing = request.active;
      state.tabId = request.tabId;
      state.captureMode = request.mode;
      sendResponse({ success: true });
      return false;

    case 'stopCapture':
      stopCapture();
      sendResponse({ success: true });
      return false;

    case 'getStatus':
      sendResponse({
        isCapturing: state.isCapturing,
        tabId: state.tabId,
        connected: state.ws?.readyState === WebSocket.OPEN,
        settings: state.settings,
      });
      return false;

    case 'setServerAddress':
      state.settings.serverAddress = `ws://${request.host}:${request.port}`;
      if (state.ws) {
        state.ws.close();
      }
      sendResponse({ success: true });
      return false;

    case 'updateSettings':
      saveSettings(request.settings);
      sendResponse({ success: true });
      return false;

    case 'getSettings':
      loadSettings().then((settings) => sendResponse({ settings }));
      return true;

    default:
      return false;
  }
});

// --- Cleanup -----------------------------------------------------------------
browserAPI.runtime.onSuspend?.addListener(() => {
  stopCapture();
});

// Log startup
console.log('[Live Translator] Background service worker initialized');
