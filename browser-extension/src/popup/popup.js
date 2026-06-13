// =============================================================================
// Live Translator – Popup (Onboarding + Model Management)
// =============================================================================

const WS_HOST = '127.0.0.1';
const WS_PORT = 9876;
let wsHost = WS_HOST;
let wsPort = WS_PORT;
let ws = null;
let models = [];

const $ = (id) => document.getElementById(id);
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

function wsUrl() { return `ws://${wsHost}:${wsPort}`; }

function loadAddress() {
  browserAPI.storage.local.get(['wsHost', 'wsPort'], (r) => {
    if (r.wsHost) wsHost = r.wsHost;
    if (r.wsPort) wsPort = parseInt(r.wsPort, 10) || WS_PORT;
  });
}

function saveAddress(host, port) {
  wsHost = host;
  wsPort = port;
  browserAPI.storage.local.set({ wsHost, wsPort });
  browserAPI.runtime.sendMessage({
    type: 'setServerAddress',
    host, port,
  }).catch(() => {});
}

// --- Views ---
function showStep(id) {
  document.querySelectorAll('.step').forEach(s => s.style.display = 'none');
  $(id).style.display = 'flex';
}

function setStatus(state, msg) {
  const icon = $('status-icon');
  const text = $('status-msg');
  icon.className = 'status-icon ' + state;
  text.textContent = msg;
}

// --- WebSocket ---
function connect() {
  setStatus('spinner', 'Looking for companion app...');
  $('btn-download').style.display = 'block';
  $('btn-retry').style.display = 'block';
  $('step-hint').style.display = 'block';

  try {
    ws = new WebSocket(wsUrl());
  } catch {
    setStatus('error', 'Could not connect');
    return;
  }

  ws.onopen = () => {
    setStatus('connected', `Connected to ${wsUrl()}`);
    $('btn-download').style.display = 'none';
    $('btn-retry').style.display = 'none';
    $('step-hint').style.display = 'none';
    send({ type: 'get_status' });
    loadModels();
    showStep('step-models');
  };

  ws.onclose = () => {
    if ($('step-models').style.display !== 'flex') {
      setStatus('error', 'Companion app not found');
    }
    ws = null;
  };

  ws.onerror = () => {
    setStatus('error', 'Connection failed');
  };

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      handleMessage(msg);
    } catch {}
  };
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// --- Message Handler ---
function handleMessage(msg) {
  if (msg.type === 'model_list') {
    models = msg.models || [];
    renderModels();
  }
  if (msg.type === 'status' && msg.status === 'model_changed') {
    $('stt-status').textContent = 'STT: Loading new model...';
    // Refresh status after a moment
    setTimeout(() => send({ type: 'get_status' }), 2000);
  }
  if (msg.type === 'status' && msg.stt) {
    if (msg.stt === 'ready') {
      $('stt-status').textContent = 'STT: Ready — ' + (msg.model.split('/').pop() || 'active');
      $('btn-start-capture').textContent = '▶ Start';
    } else {
      $('stt-status').textContent = 'STT: Unavailable — select a model';
      $('btn-start-capture').textContent = '▶ Start';
    }
  }
  if (msg.type === 'error') {
    $('stt-status').textContent = 'Error: ' + msg.message;
  }
}

// --- Model Management ---
function loadModels() {
  send({ type: 'list_models' });
}

function renderModels() {
  const list = $('model-list');
  const downloaded = models.filter(m => m.downloaded).length;

  if (models.length === 0) {
    list.textContent = '';
    const loading = document.createElement('div');
    loading.className = 'loading';
    loading.textContent = 'No models available';
    list.appendChild(loading);
    return;
  }

  list.textContent = '';

  models.forEach(m => {
    const item = document.createElement('div');
    item.className = 'model-item' + (m.active ? ' active' : '');

    const nameSpan = document.createElement('span');
    nameSpan.className = 'model-name';
    nameSpan.textContent = m.name.replace('ggml-', '').replace('.bin', '');
    item.appendChild(nameSpan);

    const tagSpan = document.createElement('span');
    tagSpan.className = m.supportsTranslate ? 'model-tag translate' : 'model-tag notranslate';
    tagSpan.textContent = m.supportsTranslate ? '🌐' : '⚡';
    item.appendChild(tagSpan);

    const sizeSpan = document.createElement('span');
    sizeSpan.className = 'model-size';
    sizeSpan.textContent = m.size;
    item.appendChild(sizeSpan);

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'model-actions';

    if (m.active) {
      const activeSpan = document.createElement('span');
      activeSpan.style.cssText = 'color:#4caf50;font-weight:600;';
      activeSpan.textContent = 'Active';
      actionsDiv.appendChild(activeSpan);
    } else if (m.downloaded) {
      const selectBtn = document.createElement('button');
      selectBtn.className = 'select';
      selectBtn.dataset.name = m.name;
      selectBtn.textContent = 'Select';
      actionsDiv.appendChild(selectBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'danger';
      delBtn.dataset.name = m.name;
      delBtn.textContent = 'Del';
      actionsDiv.appendChild(delBtn);
    } else {
      const dlBtn = document.createElement('button');
      dlBtn.dataset.name = m.name;
      dlBtn.textContent = 'Download';
      actionsDiv.appendChild(dlBtn);
    }

    item.appendChild(actionsDiv);
    list.appendChild(item);
  });

  // Bind button clicks
  list.querySelectorAll('button[data-name]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.name;
      btn.disabled = true;

      if (btn.classList.contains('danger')) {
        send({ type: 'delete_model', name });
      } else if (btn.classList.contains('select')) {
        send({ type: 'switch_model', name });
        $('stt-status').textContent = 'STT: Switching model...';
      } else {
        btn.textContent = '⌛';
        send({ type: 'download_model', name });
      }

      // Wait a bit then refresh
      setTimeout(loadModels, 1500);
    });
  });
}

function applyAddress() {
  const h = ($('ws-host')?.value || '').trim() || WS_HOST;
  const p = parseInt($('ws-port')?.value || '', 10) || WS_PORT;
  saveAddress(h, p);
  if (ws) ws.close();
  setTimeout(connect, 300);
}

function resetAddress() {
  saveAddress(WS_HOST, WS_PORT);
  if ($('ws-host')) $('ws-host').value = WS_HOST;
  if ($('ws-port')) $('ws-port').value = String(WS_PORT);
  if (ws) ws.close();
  setTimeout(connect, 300);
}

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  showStep('step-welcome');
  // Load saved address from storage, then connect
  browserAPI.storage.local.get(['wsHost', 'wsPort'], (r) => {
    if (r.wsHost) wsHost = r.wsHost;
    if (r.wsPort) wsPort = parseInt(r.wsPort, 10) || WS_PORT;
    connect();
  });

  // Retry button
  $('btn-retry').addEventListener('click', () => {
    if (ws) { ws.close(); }
    setTimeout(connect, 300);
  });

  // Server address
  $('btn-apply')?.addEventListener('click', applyAddress);
  $('btn-reset')?.addEventListener('click', resetAddress);

  // Back button (go back to welcome)
  $('btn-back').addEventListener('click', () => {
    showStep('step-welcome');
    setStatus('connected', 'Connected — select a model to begin');
    $('btn-download').style.display = 'none';
    $('btn-retry').style.display = 'none';
    $('step-hint').style.display = 'none';
  });

  // Refresh models
  $('btn-refresh').addEventListener('click', loadModels);

  // Start capture (just sends to background script)
  $('btn-start-capture').addEventListener('click', () => {
    const browserAPI = typeof browser !== 'undefined' ? browser : chrome;
    browserAPI.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length === 0) return;
      browserAPI.runtime.sendMessage({
        type: 'startCapture',
        tabId: tabs[0].id,
      }).then((r) => {
        if (r?.success) {
          $('btn-start-capture').textContent = '⏹ Stop';
        }
      });
    });
  });
});
