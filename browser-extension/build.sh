#!/usr/bin/env bash
set -euo pipefail

EXTENSION_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="$EXTENSION_DIR/dist"

echo "Building Live Translator browser extension..."

# Clean and create output directories
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR/chrome"
mkdir -p "$OUTPUT_DIR/firefox"

# =============================================================================
# Build Chrome package
# =============================================================================
echo ""
echo "  --- Chrome (MV3) ---"
CHROME_DIR="$OUTPUT_DIR/chrome"
mkdir -p "$CHROME_DIR/src/popup"
mkdir -p "$CHROME_DIR/src/icons"

# Copy source files
cp "$EXTENSION_DIR/src/background.js"        "$CHROME_DIR/src/"
cp "$EXTENSION_DIR/src/content-captions.js"  "$CHROME_DIR/src/"
cp "$EXTENSION_DIR/src/content-captions.css" "$CHROME_DIR/src/"
cp "$EXTENSION_DIR/src/popup/popup.html"     "$CHROME_DIR/src/popup/"
cp "$EXTENSION_DIR/src/popup/popup.css"      "$CHROME_DIR/src/popup/"
cp "$EXTENSION_DIR/src/popup/popup.js"       "$CHROME_DIR/src/popup/"
cp "$EXTENSION_DIR/src/icons/"*.png          "$CHROME_DIR/src/icons/"
cp "$EXTENSION_DIR/manifest.chrome.json"     "$CHROME_DIR/manifest.json"

echo "  ✓ Chrome build ready at $CHROME_DIR"

# =============================================================================
# Build Firefox package
# =============================================================================
echo "  --- Firefox (MV2) ---"
FIREFOX_DIR="$OUTPUT_DIR/firefox"
mkdir -p "$FIREFOX_DIR/src/popup"
mkdir -p "$FIREFOX_DIR/src/icons"

# Copy source files
cp "$EXTENSION_DIR/src/background.js"        "$FIREFOX_DIR/src/"
cp "$EXTENSION_DIR/src/content-captions.js"  "$FIREFOX_DIR/src/"
cp "$EXTENSION_DIR/src/content-captions.css" "$FIREFOX_DIR/src/"
cp "$EXTENSION_DIR/src/popup/popup.html"     "$FIREFOX_DIR/src/popup/"
cp "$EXTENSION_DIR/src/popup/popup.css"      "$FIREFOX_DIR/src/popup/"
cp "$EXTENSION_DIR/src/popup/popup.js"       "$FIREFOX_DIR/src/popup/"
cp "$EXTENSION_DIR/src/icons/"*.png          "$FIREFOX_DIR/src/icons/"
cp "$EXTENSION_DIR/manifest.firefox.json"    "$FIREFOX_DIR/manifest.json"

echo "  ✓ Firefox build ready at $FIREFOX_DIR"

# =============================================================================
# Create ZIP packages
# =============================================================================
echo ""
echo "  --- Packaging ---"

if command -v zip &>/dev/null; then
  cd "$CHROME_DIR"
  zip -qr "$OUTPUT_DIR/live-translator-chrome.zip" .
  echo "  ✓ $OUTPUT_DIR/live-translator-chrome.zip"

  cd "$FIREFOX_DIR"
  zip -qr "$OUTPUT_DIR/live-translator-firefox.zip" .
  echo "  ✓ $OUTPUT_DIR/live-translator-firefox.zip"

  cd "$EXTENSION_DIR"
else
  echo "  ⚠ zip not found — skipping archive creation"
fi

echo ""
echo "============================================"
echo "  ✅ Build complete!"
echo "============================================"
echo ""
echo "  Chrome:"
echo "    Load unpacked: $CHROME_DIR"
echo "    ZIP:           $OUTPUT_DIR/live-translator-chrome.zip"
echo ""
echo "  Firefox:"
echo "    Load temp add-on: $FIREFOX_DIR"
echo "    ZIP:              $OUTPUT_DIR/live-translator-firefox.zip"
echo ""
echo "  Store submission checklist:"
echo "    □ Chrome: https://chrome.google.com/webstore/devconsole"
echo "    □ Firefox: https://addons.mozilla.org/developers/"
echo "    □ Privacy policy required for both stores"
echo "    □ See browser-extension/store-listing-*.md for details"
echo ""
