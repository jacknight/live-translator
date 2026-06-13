# Chrome Web Store Listing

Use this information when submitting to the Chrome Web Store.

---

## Store Details

- **Extension name:** Live Translator
- **Short description:** (132 characters max)
  Real-time audio translation with close-captioning on videos. Uses a local companion app for private STT.
- **Detailed description:**

  **Real-time captions for any video — fully private, running on your machine.**

  Live Translator captures audio from your browser tabs and overlays live captions with translation directly onto videos. Everything runs locally via a companion app — no cloud services, no data sent to external servers.

  **How it works:**

  1. Install the companion app (see GitHub repo for instructions)
  2. Click the extension icon to open the popup
  3. Select a speech-to-text model (whisper.cpp)
  4. Play any video — captions appear automatically

  **Features:**
  - Real-time speech-to-text using whisper.cpp (fully offline)
  - Translation to multiple target languages
  - Close-captioning overlay on HTML5 video elements
  - Capture button injected directly on video players (YouTube, Twitch, etc.)
  - Adjustable caption opacity, font size, and position
  - Privacy-first: everything runs locally

  **Requirements:**
  - A local companion app (see GitHub repo)
  - Chrome 116+

  **Open source:**
  https://github.com/jacknight/live-translator

- **Category:** Accessibility
- **Language:** English only

## Icons

Icons are in `src/icons/`:
- 16×16: `icon-16.png`
- 48×48: `icon-48.png`
- 128×128: `icon-128.png`

## Screenshots

Recommended screenshots (1280×800 or 640×400 PNG):

1. **Popup with model selection** — Show the extension popup listing available STT models
2. **Video with captions** — A video player with live captions overlaid at the bottom
3. **Settings view** — The companion app window showing available settings

## Promotional Tiles

- **Small tile:** 440×280 (optional)
- **Marquee tile:** 1400×560 (optional)

## Privacy Policy

URL: `https://github.com/jacknight/live-translator/blob/main/browser-extension/PRIVACY.md`

Or host the PRIVACY.md content on your own site / GitHub Pages.

## Permissions Justification

| Permission | Why needed |
|---|---|
| `tabCapture` | Capture audio from the current browser tab for transcription |
| `storage` | Save user preferences (language, caption style, server address) |
| `activeTab` | Access the current tab to inject captions and detect video elements |
| `scripting` | Inject caption overlay styles and capture button into pages |
| `offscreen` | Chrome MV3 requirement for tabCapture to work from service workers |
| `<all_urls>` host permissions | Inject caption overlays on any website with video content |

## Testing Notes

- Extension requires the local companion app to function fully
- Without the companion app, the popup shows "Companion app not found" with a download link
- The capture button on videos injects after detecting video elements on the page
