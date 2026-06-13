// =============================================================================
// Live Translator – Content Script (Captions)
// =============================================================================
//
// Injects captions into HTML5 video elements or creates a floating overlay
// on the page. Controlled by messages from the background service worker.
// =============================================================================

(function () {
  'use strict';

  const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

  // --- Server address (loaded from storage, updated on change) ---------------
  let serverHost = '127.0.0.1';
  let serverPort = 9876;
  function loadServerAddress() {
    browserAPI.storage.local.get(['wsHost', 'wsPort'], (r) => {
      if (r.wsHost) serverHost = r.wsHost;
      if (r.wsPort) serverPort = parseInt(r.wsPort, 10) || 9876;
    });
  }
  loadServerAddress();
  // Pick up host/port changes made in the popup without page reload
  browserAPI.storage.onChanged.addListener((changes) => {
    if (changes.wsHost || changes.wsPort) loadServerAddress();
  });
  function serverUrl() { return `ws://${serverHost}:${serverPort}`; }

  // --- State -----------------------------------------------------------------
  let active = false;
  let captionMode = 'video';
  let currentText = '';
  let currentTranslation = '';
  let opacity = 0.9;
  let fontSize = 24;
  let containerId = 'live-translator-captions';

  // DOM elements
  let captionContainer = null;
  let silenceTimer = null;

  // Inject capture button next to any video
  let trackedVideo = null;

  function injectCaptureButton(video) {
    if (document.getElementById('lt-capture-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'lt-capture-btn';
    btn.textContent = '▶ Caption';
    btn.title = 'Toggle live captions';
    video.insertAdjacentElement('afterend', btn);

    const parent = video.parentElement;
    if (parent && getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (btn.classList.contains('active')) {
        browserAPI.runtime.sendMessage({ type: 'stopCapture' });
        stopPageAudioCapture();
        btn.classList.remove('active');
        btn.textContent = '▶ Caption';
      } else {
        startPageAudioCapture(serverUrl());
        btn.classList.add('active');
        btn.textContent = '⏹ Stop';
      }
    });

    // Show button when hovering the video OR its container
    // (Twitch overlays elements on top of <video>, so video:hover won't fire)
    const container = video.closest('[class*="player"], [class*="video"], [class*="Video"], [id*="player"], [id*="video"]')
      || video.parentElement;

    function showBtn() { btn.style.opacity = '1'; }
    function hideBtn() { btn.style.opacity = '0'; }

    container.addEventListener('mouseenter', showBtn);
    container.addEventListener('mouseleave', (e) => {
      if (!btn.contains(e.relatedTarget)) hideBtn();
    });
    btn.addEventListener('mouseenter', showBtn);
    btn.addEventListener('mouseleave', hideBtn);

    trackedVideo = video;

  }

  // Watch for video elements appearing dynamically (Twitch, YouTube)
  function watchForVideos() {
    const check = () => {
      if (document.getElementById('lt-capture-btn')) return;
      document.querySelectorAll('video').forEach(v => {
        const r = v.getBoundingClientRect();
        if (r.width > 50 && r.height > 50) injectCaptureButton(v);
      });
    };

    check();
    const obs = new MutationObserver(check);
    obs.observe(document.body, { childList: true, subtree: true });
    // Also recheck periodically for SPAs
    setInterval(check, 2000);
  }

  function createVideoOverlay() {
    const videos = document.querySelectorAll('video');
    if (videos.length === 0) return null;

    let targetVideo = null;
    let maxArea = 0;

    videos.forEach((v) => {
      const rect = v.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > maxArea && rect.width > 100) {
        maxArea = area;
        targetVideo = v;
      }
    });

    if (!targetVideo) return null;

    const existing = document.getElementById(containerId);
    if (existing) { if (existing._positionCleanup) existing._positionCleanup(); existing.remove(); }

    // Wrap video in a relative container if not already
    let wrapper = targetVideo.parentElement;
    if (getComputedStyle(wrapper).position === 'static') {
      wrapper.style.position = 'relative';
    }

    const overlay = document.createElement('div');
    overlay.id = containerId;
    overlay.style.cssText = [
      'position: absolute',
      'bottom: 8px',
      'left: 50%',
      'transform: translateX(-50%)',
      'z-index: 9999',
      'pointer-events: none',
      'text-align: center',
      'max-width: 90%',
      'display: none',
    ].join(';');

    captionContainer = overlay;
    wrapper.appendChild(overlay);
    overlay._positionCleanup = () => {};

    applyStyles();
    return overlay;
  }

  function updateContainer() {
    createVideoOverlay();
    updateDisplay();
  }

  // --- Styling ---------------------------------------------------------------
  function applyStyles() {
    if (!captionContainer) return;
    const alpha = Math.min(1, Math.max(0, opacity));
    captionContainer.style.background = `rgba(0, 0, 0, ${alpha})`;
    captionContainer.style.color = '#fff';
    captionContainer.style.fontSize = fontSize + 'px';
    captionContainer.style.padding = '6px 14px';
    captionContainer.style.borderRadius = '6px';
    captionContainer.style.fontFamily = '-apple-system, BlinkMacSystemFont, sans-serif';
    captionContainer.style.lineHeight = '1.4';
  }

  function updateDisplay() {
    if (!captionContainer) return;
    const text = currentText || currentTranslation || '';
    captionContainer.textContent = text;
    captionContainer.style.display = text ? 'block' : 'none';
    captionContainer.classList.toggle('lt-visible', !!text);

    if (text && silenceTimer) clearTimeout(silenceTimer);
    if (text) {
      silenceTimer = setTimeout(() => {
        currentText = '';
        currentTranslation = '';
        if (captionContainer) {
          captionContainer.style.display = 'none';
          captionContainer.classList.remove('lt-visible');
        }
      }, 5000);
    }
  }

  // --- Firefox Audio Capture (captureStream on video elements) ----------------
  let captureStream = null;
  let captureCtx = null;
  let captureProcessor = null;
  let captureWs = null;
  let captureSource = null;

  let captureInitOk = false; // true if captureStream setup succeeded

  function startPageAudioCapture(wsAddress) {
    const videos = document.querySelectorAll('video');
    let targetVideo = null;
    let maxArea = 0;

    videos.forEach((v) => {
      const rect = v.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (v.readyState >= 2 && area > maxArea) {
        maxArea = area;
        targetVideo = v;
      }
    });

    if (!targetVideo) {
      const btn = document.getElementById('lt-capture-btn');
      if (btn) { btn.classList.remove('active'); btn.textContent = '▶ Caption'; }
      captureInitOk = false;
      return;
    }

    try {
      captureStream = targetVideo.captureStream();
      if (!captureStream) {
        captureInitOk = false;
        return;
      }

      const audioTracks = captureStream.getAudioTracks();
      if (audioTracks.length === 0) {
        captureInitOk = false;
        return;
      }

      captureInitOk = true;
      captureWs = new WebSocket(wsAddress);

      captureWs.onopen = () => {
        const btn = document.getElementById('lt-capture-btn');
        if (btn) btn.textContent = '⏹ Stop';

        browserAPI.storage.local.get('settings', (result) => {
          const lang = result?.settings || {};
          captureWs.send(JSON.stringify({
            type: 'config',
            sourceLanguage: lang.sourceLanguage || 'auto',
            targetLanguage: lang.targetLanguage || 'en',
          }));
        });

        captureCtx = new AudioContext({ sampleRate: 16000 });
        if (captureCtx.state === 'suspended') captureCtx.resume();
        const ctxRate = captureCtx.sampleRate;
        captureSource = captureCtx.createMediaStreamSource(captureStream);
        captureProcessor = captureCtx.createScriptProcessor(4096, 1, 1);

        captureSource.connect(captureProcessor);
        captureProcessor.connect(captureCtx.destination);

        captureProcessor.onaudioprocess = (event) => {
          if (!captureWs || captureWs.readyState !== WebSocket.OPEN) return;

          const inputData = event.inputBuffer.getChannelData(0);
          const pcmData = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }

          const header = new Uint32Array([ctxRate]);
          const msg = new Uint8Array(header.buffer.byteLength + pcmData.buffer.byteLength);
          msg.set(new Uint8Array(header.buffer), 0);
          msg.set(new Uint8Array(pcmData.buffer), header.buffer.byteLength);
          captureWs.send(msg.buffer);
        };
      };

      captureWs.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'transcription') {
            currentText = msg.text || '';
            updateDisplay();
          } else if (msg.type === 'translation') {
            currentTranslation = msg.text || '';
            updateDisplay();
          }
        } catch {}
      };

      captureWs.onclose = () => stopPageAudioCapture();

      captureWs.onerror = () => {
        const btn = document.getElementById('lt-capture-btn');
        if (btn) { btn.classList.remove('active'); btn.textContent = '▶ Caption'; }
      };

      // Start captions
      active = true;
      updateContainer();

    } catch (err) {
      // captureStream not supported on this page
    }
  }

  function stopPageAudioCapture() {
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
    if (captureProcessor) {
      captureProcessor.disconnect();
      captureProcessor = null;
    }
    if (captureSource) {
      captureSource.disconnect();
      captureSource = null;
    }
    if (captureCtx) {
      captureCtx.close();
      captureCtx = null;
    }
    if (captureStream) {
      captureStream.getTracks().forEach(t => t.stop());
      captureStream = null;
    }
    if (captureWs) {
      captureWs.close();
      captureWs = null;
    }
    active = false;
  }

  // --- Message Handler -------------------------------------------------------
  browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object') return;

    switch (message.action) {
      case 'START_CAPTIONS':
        active = true;
        currentText = '';
        currentTranslation = '';
        updateContainer();
        break;

      case 'STOP_CAPTIONS':
        active = false;
        currentText = '';
        currentTranslation = '';
        updateDisplay();
        if (captionContainer) {
          if (captionContainer._positionCleanup) captionContainer._positionCleanup();
          captionContainer.remove();
          captionContainer = null;
          videoOverlay = null;
        }
        break;

      case 'TRANSCRIPTION':
        if (!active) return;
        currentText = message.data?.original || '';
        currentTranslation = message.data?.translated || '';
        if (!captionContainer) updateContainer();
        updateDisplay();
        break;

      case 'TRANSLATION':
        if (!active) return;
        currentTranslation = message.data?.text || '';
        if (!captionContainer) updateContainer();
        updateDisplay();
        break;

      case 'UPDATE_STYLES':
        if (message.data?.opacity !== undefined) opacity = message.data.opacity;
        if (message.data?.fontSize !== undefined) fontSize = message.data.fontSize;
        applyStyles();
        break;

      case 'CAPTURE_PAGE_AUDIO': {
        startPageAudioCapture(message.data?.wsAddress || serverUrl());
        if (!captureInitOk) {
          // captureStream failed immediately — respond synchronously
          sendResponse({ started: false, error: 'No audio source found on page' });
          return false;
        }
        // Wait for WebSocket to connect, then respond
        setTimeout(() => {
          const wsOk = captureWs?.readyState === WebSocket.OPEN;
          sendResponse({ started: wsOk, error: wsOk ? null : 'WebSocket not connected' });
        }, 1500);
        return true; // Keep channel open for async sendResponse
      }

      case 'UPDATE_LANG_CONFIG':
        if (captureWs && captureWs.readyState === WebSocket.OPEN) {
          captureWs.send(JSON.stringify({
            type: 'config',
            sourceLanguage: message.data?.sourceLanguage || 'auto',
            targetLanguage: message.data?.targetLanguage || 'en',
          }));
        }
        break;

      case 'STOP_PAGE_AUDIO':
        stopPageAudioCapture();
        break;
    }
  });

  // Start watching for videos to inject the capture button
  watchForVideos();


})();
