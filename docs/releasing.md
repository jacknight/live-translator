# Releasing

## Automated builds via GitHub Actions

The repo has a GitHub Actions workflow (`.github/workflows/build.yml`) that auto-builds the companion app for macOS, Windows, and Linux whenever you push a tag.

### Create a release

```bash
# 1. Commit your changes
git add .
git commit -m "v0.1.0 release"

# 2. Tag the version
git tag v0.1.0

# 3. Push — this triggers the build
git push origin main --tags
```

GitHub Actions will:
1. Build the companion app on macOS, Windows, and Linux
2. Package each into `.dmg`, `.exe`, `.AppImage`
3. Create a GitHub Release with all three downloads attached

### Manual build (alternative)

```bash
cd companion-app
npm run electron:build:mac    # → release/*.dmg
npm run electron:build:win    # → release/*.exe
npm run electron:build:linux  # → release/*.AppImage
```

## Extension store submission

### Firefox Add-ons

```bash
cd browser-extension
npx web-ext build
# Upload web-ext-artifacts/*.zip to https://addons.mozilla.org
```

### Chrome Web Store

```bash
cd browser-extension
./build.sh
# Zip dist/chrome/ and upload to https://chrome.google.com/webstore/devconsole
```

## Version bump

Update version in:
- `companion-app/package.json`
- `browser-extension/manifest.chrome.json`
- `browser-extension/manifest.firefox.json`
