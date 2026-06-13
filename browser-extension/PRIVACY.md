# Privacy Policy for Live Translator

**Last updated:** June 26, 2026

## Overview

Live Translator is a browser extension that provides real-time audio translation and captioning for videos. This privacy policy explains how the extension handles user data.

## Data Collection

### Audio Data
- **What we collect:** When you activate the extension, audio from the current browser tab is captured and streamed to a locally running companion application on your computer.
- **How it's used:** The audio is processed exclusively on your local machine by the companion app (whisper.cpp) for speech-to-text transcription and translation.
- **Data retention:** Audio data is processed in real-time and is not stored, logged, or retained. No audio recordings are kept after processing.
- **Data transmission:** Audio data is sent only to the local companion app running on your computer at `ws://127.0.0.1:9876`. It is never transmitted to external servers or third parties.

### Settings and Preferences
- **What we collect:** Your extension settings (target language, source language, caption style preferences, server address).
- **How it's stored:** Settings are stored locally in your browser using the `storage.local` API. They never leave your browser.
- **Purpose:** To remember your preferences between sessions.

### No Personal Information
- Live Translator does **not** collect, store, or transmit any personal information, browsing history, passwords, or other sensitive data.
- The extension does **not** use analytics, tracking cookies, or telemetry.
- The extension does **not** communicate with any remote servers other than the local companion app you intentionally run.

## Third-Party Access

No user data is shared with third parties. The companion app (whisper.cpp, Argos Translate) runs entirely on your local machine.

## Data Security

Since all processing is performed locally on your machine and no data is transmitted externally, there are minimal data security risks. Standard browser security sandboxing applies.

## Changes to This Policy

If this privacy policy changes, the version date at the top will be updated.

## Contact

For questions about this privacy policy, please open an issue on the project repository:
https://github.com/jacknight/live-translator
