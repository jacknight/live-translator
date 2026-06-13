# Setup Guide

## Prerequisites

1. **Node.js** >= 18 (for the companion app)
2. **whisper.cpp** compiled binary
3. **Chrome** >= 116 or **Firefox** >= 121

---

## Option A: Quick Setup (Recommended)

```bash
cd live-translator/companion-app

# Install deps and check prerequisites
npm install

# Auto-setup whisper.cpp: clones, builds, and downloads a model
npm run setup-whisper

# Copy the .env config and adjust if needed
cp .env.example .env
# (setup-whisper above already creates .env automatically)
```

## Option B: Manual Setup

### 1. Install

```bash
cd live-translator/companion-app
npm install
```

### 2. Build whisper.cpp

```bash
# Clone whisper.cpp (outside the project)
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp

# Build
make -j$(nproc)  # or make -j4 on macOS

# Download a model (small models are faster for real-time)
bash models/download-ggml-model.sh base.en

# Test it works
./main -m models/ggml-base.en.bin -f samples/jfk.wav
```

### 3. Configure via .env

Copy the example and edit the paths:

```bash
cd companion-app
cp .env.example .env
```

Edit `.env` to point at your whisper.cpp build:

```bash
LT_WHISPER_EXEC=/Users/jack/Development/whisper.cpp/main
LT_WHISPER_MODEL=/Users/jack/Development/whisper.cpp/models/ggml-base.en.bin

# Translation settings
LT_SOURCE_LANG=auto
LT_TARGET_LANG=en
LT_TRANSLATOR_BACKEND=null       # or libretranslate, deepl, google

# Overlay
LT_OVERLAY=true
LT_OVERLAY_OPACITY=0.9
```

Environment variables override .env values, so you can also do:

```bash
LT_WHISPER_EXEC=/custom/path ./main npm start
```

## 4. Start the Companion App

```bash
cd companion-app

# Headless mode (server only, no floating overlay)
npm run build && npm start

# Or with Electron (floating overlay window)
npm run electron:start
```

## 5. Build & Load the Extension

### Chrome

```bash
cd browser-extension
./build.sh
```

Then:

1. Go to `chrome://extensions`
2. Enable "Developer mode" (top-right toggle)
3. Click "Load unpacked"
4. Select `browser-extension/dist/chrome/`
5. Pin the extension for easy access

### Firefox

```bash
cd browser-extension
./build.sh
```

Then:

1. Go to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on..."
3. Select `browser-extension/dist/firefox/manifest.json`

## 6. Use It

1. Navigate to a page with audio (YouTube, Netflix, podcast, etc.)
2. Click the extension icon
3. Click "Start Listening"
4. Grant microphone/tab audio permission when prompted
5. Captions will appear on the video or as a floating overlay

---

## Translation Backends

### Option A: LibreTranslate (Local, Recommended)

```bash
docker run -d --restart always \
  -p 5000:5000 \
  libretranslate/libretranslate:latest \
  --load-only en,es,fr,de,ja,zh,ko
```

### Option B: DeepL (Cloud, Free Tier Available)

1. Sign up at https://www.deepl.com/pro-api
2. Get your API key
3. Set `export LT_TRANSLATOR_API_KEY=your-key-here`
4. Set `export LT_TRANSLATOR_BACKEND=deepl`

### Option C: Google Cloud Translation

1. Enable Cloud Translation API in GCP
2. Create a service account and download the key
3. Set `export LT_TRANSLATOR_API_KEY=your-api-key`
4. Set `export GOOGLE_PROJECT_ID=your-project-id`
5. Set `export LT_TRANSLATOR_BACKEND=google`

---

---

## Can whisper.cpp be installed as an npm package?

**Yes!** There are several npm packages that wrap whisper.cpp with
Node.js bindings, so you don't need to clone and build it manually.

| Package | Approach | Notes |
|---------|----------|-------|
| [`whisper-node`](https://www.npmjs.com/package/whisper-node) | Node.js bindings via node-gyp | Compiles whisper.cpp at install time. Easy to use, returns transcript with timestamps. |
| [`node-whisper`](https://www.npmjs.com/package/node-whisper) | Spawns whisper.cpp subprocess | Thin wrapper, same as what we do manually. |
| [`whisper.cpp`](https://www.npmjs.com/package/whisper.cpp) | Official (experimental) bindings | Direct C++ bindings via node-addon-api. Very fast but less battle-tested. |
| [`faster-whisper`](https://www.npmjs.com/package/faster-whisper) | Python bridge via child_process | Uses CTranslate2 — faster than raw whisper.cpp, but needs Python. |

### Switching to whisper-node (example)

To use an npm package instead of building manually:

```bash
cd companion-app
npm install whisper-node
```

Then modify `src/stt/whisper.ts` to use the package instead of spawning
a subprocess. The core `transcribe(audio, sampleRate)` interface stays
identical.

### Why we default to subprocess

The current design spawns `whisper.cpp/main` directly because:

1. **Zero npm dependency** on a C++ build toolchain (`node-gyp`, `python`, etc.)
2. **You already compiled it** — we just call the binary
3. **Easy to debug** — you can test the binary independently
4. **Same performance** — no overhead from bindings

But swapping to `whisper-node` or `faster-whisper` is straightforward
and would improve startup time (no temp WAV file writes).

## Performance Tips

### For Real-time Transcription

- Use `base.en` or `tiny.en` models for fastest inference
- The `small` model is a good balance for most users
- `medium` and `large` models have ~1-3s latency

### Audio Quality

- Ensure the tab's audio is clear (not too quiet)
- Close other tabs playing audio to reduce interference
- The extension captures only the current tab's audio

### Memory

- whisper.cpp uses 100-500MB RAM depending on model size
- The companion app uses ~50MB base + model memory
- Electron overlay adds ~150MB when active
