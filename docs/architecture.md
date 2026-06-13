# Architecture

## Overview

Live Translator consists of two main components that communicate over a local WebSocket connection:

```
┌─────────────────────────────────┐      WebSocket       ┌──────────────────────────────────────┐
│        Browser Extension        │ ◄──── audio data ───►│          Companion App                │
│                                 │      ─── captions ──►│                                      │
│  ┌───────────────────────────┐  │                      │  ┌────────────────────────────────┐  │
│  │    background.js          │  │                      │  │  WebSocket Server (port 9876)   │  │
│  │   (Service Worker)        │──┼──────────────────────►│  │  - Receives PCM audio          │  │
│  │                           │  │                      │  │  - Sends transcription          │  │
│  │  • tabCapture API         │  │                      │  │  - Sends translation            │  │
│  │  • AudioContext→PCM       │  │                      │  └──────────┬─────────────────────┘  │
│  │  • WebSocket client       │  │                      │             │                        │
│  └───────────────────────────┘  │                      │  ┌──────────▼─────────────────────┐  │
│              │                  │                      │  │       Whisper STT              │  │
│  ┌───────────▼──────────────┐  │                      │  │  (whisper.cpp subprocess)      │  │
│  │    content-captions.js   │  │                      │  │  • PCM → WAV file             │  │
│  │   (Content Script)       │  │                      │  │  • spawn whisper.cpp          │  │
│  │                           │  │                      │  │  • parse stdout text           │  │
│  │  • Injects <div> overlay  │  │                      │  └──────────┬─────────────────────┘  │
│  │  • Positions on video     │  │                      │             │                        │
│  │  • Floating page overlay  │  │                      │  ┌──────────▼─────────────────────┐  │
│  └───────────────────────────┘  │                      │  │         Translator             │  │
│                                 │                      │  │  • Local: LibreTranslate       │  │
│  ┌───────────────────────────┐  │                      │  │  • Local: Bergamot/Marian     │  │
│  │        popup.html         │  │                      │  │  • Cloud: DeepL, Google        │  │
│  │   (Extension Popup)       │  │                      │  │  • Fallback: null (passthrough)│  │
│  │                           │  │                      │  └──────────┬─────────────────────┘  │
│  │  • Start/Stop capture     │  │                      │             │                        │
│  │  • Settings panel         │  │                      │  ┌──────────▼─────────────────────┐  │
│  │  • Caption preview        │  │                      │  │     Overlay Manager           │  │
│  └───────────────────────────┘  │                      │  │  (Electron transparent window) │  │
│                                 │                      │  │  • Always-on-top              │  │
│                                 │                      │  │  • Mouse passthrough           │  │
│                                 │                      │  │  • 90% opacity background      │  │
│                                 │                      │  └────────────────────────────────┘  │
└─────────────────────────────────┘                      └──────────────────────────────────────┘
```

## Data Flow

### Audio Capture → Caption Display

```
Tab Audio → tabCapture API → AudioContext (16000 Hz, mono)
  → ScriptProcessor → Float32→Int16 PCM → WebSocket binary message
  → Companion App receives → buffers ~3 seconds
  → Write temp WAV file → spawn whisper.cpp → read stdout
  → Transcribed text → Translator → Translated text
  → WebSocket JSON message back to extension
  → Content script updates DOM: video overlay or floating <div>
  → Also sent to Electron overlay window (if active)
```

### Caption Mode Selection

```
                ┌── Page has <video> element ──► Video Overlay
                │
User selects ───┼── "Video" mode ───────────────► Video Overlay (force)
                │
                └── "Floating" mode ─────────────► Page-level floating overlay

Additionally: Companion App overlay shows captions
in front of ALL windows when browser is minimized.
```

## Timing & Latency

| Step | Estimated Time |
|------|---------------|
| Audio capture & streaming | ~100ms |
| Audio buffering (3s) | 0ms (overlaps with capture) |
| whisper.cpp inference | ~500ms–2s (depends on model) |
| Translation | ~100ms–1s (depends on backend) |
| Caption display | ~50ms |
| **Total end-to-end** | **~750ms–3.3s** |

## Translation Backend Comparison

| Backend | Type | Quality | Latency | Offline | Setup |
|---------|------|---------|---------|---------|-------|
| None (passthrough) | - | - | 0ms | ✅ | Default |
| LibreTranslate | Local HTTP API | Good | ~200ms | ✅ | `docker run -p 5000:5000 libretranslate/libretranslate` |
| Bergamot/Marian | Local binary | Good | ~300ms | ✅ | Download model, set `LT_BERGAMOT_PATH` |
| DeepL | Cloud API | Excellent | ~150ms | ❌ | Set `LT_TRANSLATOR_API_KEY` |
| Google Cloud | Cloud API | Excellent | ~150ms | ❌ | Set `LT_TRANSLATOR_API_KEY` + `GOOGLE_PROJECT_ID` |

## Compatibility

| Browser | Tab Audio Capture | MV3 | Notes |
|---------|------------------|-----|-------|
| Chrome 116+ | ✅ | ✅ | Full support |
| Firefox 121+ | ✅ | ✅ | Uses `browser.*` API |
| Edge 116+ | ✅ | ✅ | Chromium-based |
| Safari | ❌ | ❌ | Not yet supported |
