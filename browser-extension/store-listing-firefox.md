# Firefox Add-ons (AMO) Listing

Use this information when submitting to the Firefox Add-ons store.

---

## Add-on Details

- **Add-on name:** Live Translator
- **Summary:** (50 characters recommended)
  Real-time captions & translation for videos.
- **Description:**

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
  - Privacy-first: everything runs locally

  **Requirements:**
  - A local companion app (see GitHub repo)
  - Firefox 109+

  **Open source:**
  https://github.com/jacknight/live-translator

- **Category:** Accessibility
- **Tags:** captions, translation, stt, speech-to-text, whisper

## Icons

Icons are in `src/icons/`:
- 16×16: `icon-16.png`
- 48×48: `icon-48.png`
- 128×128: `icon-128.png`

## Screenshots

Recommended screenshots:

1. **Popup with model selection** — Show the extension popup listing available STT models
2. **Video with captions** — A video player with live captions overlaid at the bottom
3. **Companion app** — The companion app UI showing translation settings

## Privacy Policy

URL: `https://github.com/jacknight/live-translator/blob/main/browser-extension/PRIVACY.md`

Firefox Add-ons requires a privacy policy if the add-on handles user data. Since we process audio, a policy is required.

## Add-on ID

The add-on ID is set in `manifest.firefox.json`:
```
browser_specific_settings.gecko.id = "live-translator@jacknight.me"
```

This ID must be unique across AMO. If submitting for the first time, the review team may ask you to change it — update it in the manifest before re-submitting.

## Permissions Justification

| Permission | Why needed |
|---|---|
| `storage` | Save user preferences (language, caption style, server address) |
| `activeTab` | Access the current tab to inject captions and detect video elements |
| `<all_urls>` | Inject caption overlays on any website with video content |

> **Note:** Firefox does not support the `tabCapture` API. Audio capture in Firefox works by using the HTML5 `captureStream()` API on video elements directly from the content script. See `content-captions.js` for the implementation.

## Self-Distribution Notes

- Extension package: `dist/live-translator-firefox.zip`
- For development/testing, use `about:debugging#/runtime/this-firefox` and load the `dist/firefox/` directory as a Temporary Add-on
