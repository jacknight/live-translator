# Live Translator

Real-time audio translation for your browser — captures audio from any tab, transcribes it with [whisper.cpp](https://github.com/ggerganov/whisper.cpp), translates it, and overlays captions as close-captioning on videos or as floating windows over all applications.

## Architecture

```
┌─────────────────────┐     WebSocket      ┌──────────────────────────────┐
│   Browser Extension │ ◄──── audio ─────► │       Companion App          │
│                     │     ─── captions ─► │                              │
│  ┌───────────────┐  │                    │  ┌───────────────┐           │
│  │ tabCapture    │  │                    │  │ whisper.cpp   │           │
│  │ Audio Stream  │──┼───────────────────►│  │ (STT)         │           │
│  └───────────────┘  │                    │  └───────┬───────┘           │
│         │           │                    │          ▼                   │
│  ┌───────▼───────┐  │                    │  ┌───────────────┐           │
│  │ Caption       │  │                    │  │ Translator    │           │
│  │ Overlay       │  │◄──── text ─────────┼──│ (Argos/NMT)   │           │
│  └───────────────┘  │                    │  └───────────────┘           │
│                     │                    │                              │
│  • In-video captions │                   │  • Floating overlay window   │
│  • Floating overlay  │                   │  • (when browser minimized)  │
│  • Popup controls    │                   │                              │
└─────────────────────┘                    └──────────────────────────────┘
```

## Project Structure

```
live-translator/
├── browser-extension/        # Chrome & Firefox extension
│   ├── manifest.chrome.json
│   ├── manifest.firefox.json
│   └── src/
│       ├── background.js         # Service worker, tab capture, WebSocket
│       ├── content-captions.js   # Injects captions into video pages
│       └── popup/                # Extension popup UI
├── companion-app/            # Desktop companion (Node.js + Electron)
│   ├── src/
│   │   ├── main/                 # Electron main process
│   │   ├── stt/                  # Speech-to-text (whisper.cpp)
│   │   ├── overlay/              # Floating overlay window
│   │   └── server.ts             # WebSocket server entry
│   └── package.json
└── docs/
```

## Prerequisites

- **Node.js** >= 18
- **whisper.cpp** compiled binary (see [whisper.cpp](https://github.com/ggerganov/whisper.cpp))
- **Chrome** >= 116 or **Firefox** >= 121 (for MV3 support)

## Quick Start

### 1. Install & Build the Companion App

```bash
cd companion-app
npm install
```

After install, the `postinstall` script will check if whisper.cpp is ready
and show setup instructions if needed.

### 2. Set up whisper.cpp (automatic)

The easiest way — this clones, builds, and downloads a model in one step:

```bash
cd companion-app
npm run setup-whisper
```

This will:
1. Clone [whisper.cpp](https://github.com/ggerganov/whisper.cpp) into `./whisper.cpp/`
2. Run `make -j` to build the `main` binary
3. Download the `base.en` model (~140MB) from HuggingFace
4. Create a `.env` file with paths pre-configured

Alternatively, set up manually:

```bash
# Clone and build whisper.cpp
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp
make -j$(nproc)
bash models/download-ggml-model.sh base.en

# Then point the companion app at it via .env or environment variables
```

### 3. Configure via .env

Copy the example and edit:

```bash
cd companion-app
cp .env.example .env
# Edit LT_WHISPER_EXEC and LT_WHISPER_MODEL paths if needed
```

Or use environment variables directly:

```bash
export LT_WHISPER_EXEC=/path/to/whisper.cpp/main
export LT_WHISPER_MODEL=/path/to/whisper.cpp/models/ggml-base.en.bin
export LT_TARGET_LANG=en
```

### 4. Start the companion app

```bash
cd companion-app
npm start
```

For the floating overlay window (cross-platform, always-on-top captions):

```bash
cd companion-app
npm run electron:start
```

### 3. Load the Extension

**Chrome:**
1. Go to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `browser-extension/` after running `build.sh`

**Firefox:**
1. Go to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select `browser-extension/manifest.firefox.json`

### 4. Start Translating

1. Click the extension icon to open the popup
2. Click "Start Listening"
3. Play a video or audio in the current tab
4. Captions appear over the video or as a floating overlay

## Features

- ✅ **Real-time speech-to-text** via whisper.cpp (local, private)
- ✅ **Translation** to multiple target languages
- ✅ **Close-captioning** on HTML5 video elements
- ✅ **Floating overlay** when browser is minimized
- ✅ **Cross-platform** (macOS, Windows, Linux)
- ✅ **Fully offline-capable** (with local translation models)
- ✅ **90% opacity** floating captions

## Configuration

Settings are managed from the extension popup:

| Setting | Description |
|---------|-------------|
| Source Language | Auto-detect or specify |
| Target Language | Translation output language |
| Server Address | Companion app host:port |
| Caption Mode | Video overlay or floating |
| Opacity | Caption background opacity |
| Font Size | Caption text size |
| Whisper Model | Model size (tiny, base, small, medium) |

## Development

```bash
# Watch mode for companion app
cd companion-app && npm run dev

# Build extension for both browsers
cd browser-extension && ./build.sh

# Run tests
cd companion-app && npm test
```

## License

MIT
