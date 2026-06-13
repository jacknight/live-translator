#!/usr/bin/env node
/**
 * download-model.js – Downloads a whisper.cpp model to node_modules/.whisper/models/
 *
 * Usage:
 *   npm run download-model              # downloads model from .env or base.en
 *   npm run download-model -- tiny.en   # downloads a specific model
 *
 * Models: tiny, tiny.en, base, base.en, small, small.en,
 *         medium, medium.en, large-v3
 */

const { existsSync, copyFileSync } = require('fs');
const { resolve } = require('path');
const { execSync } = require('child_process');

try {
  require('dotenv').config({ path: resolve(__dirname, '../.env') });
} catch { /* ignore */ }

const TARGET_DIR = resolve(__dirname, '..', 'node_modules', '.whisper', 'models');
const OLD_DIR = resolve(__dirname, '..', 'whisper.cpp', 'models');
const MODEL_SIZE = process.argv[2] || process.env.LT_WHISPER_MODEL_SIZE || 'base.en';
const MODEL_NAME = `ggml-${MODEL_SIZE}.bin`;

async function main() {
  console.log(`\n  Model: ${MODEL_SIZE}\n`);

  const targetPath = resolve(TARGET_DIR, MODEL_NAME);

  // 1. Check if already in the right place
  if (existsSync(targetPath)) {
    const mb = (require('fs').statSync(targetPath).size / 1024 / 1024).toFixed(0);
    console.log(`  ✓ Already at: ${targetPath} (${mb}MB)\n`);
    return;
  }

  // 2. Check old location and copy if found
  const oldPath = resolve(OLD_DIR, MODEL_NAME);
  if (existsSync(oldPath)) {
    const mb = (require('fs').statSync(oldPath).size / 1024 / 1024).toFixed(0);
    console.log(`  Found at old location (whisper.cpp/models/), copying...`);
    if (!existsSync(TARGET_DIR)) {
      require('fs').mkdirSync(TARGET_DIR, { recursive: true });
    }
    copyFileSync(oldPath, targetPath);
    console.log(`  ✓ Copied to: ${targetPath} (${mb}MB)\n`);
    return;
  }

  // 3. Download fresh
  console.log(`  Downloading ${MODEL_NAME}...`);

  if (!existsSync(TARGET_DIR)) {
    require('fs').mkdirSync(TARGET_DIR, { recursive: true });
  }

  // Try whisper.cpp's built-in download script first
  const modelScript = resolve(__dirname, '..', 'whisper.cpp', 'models', 'download-ggml-model.sh');
  if (existsSync(modelScript)) {
    execSync(`bash "${modelScript}" ${MODEL_SIZE}`, {
      cwd: TARGET_DIR,
      stdio: 'inherit',
    });
    // The script saves to cwd, so it should be in TARGET_DIR already
  } else {
    const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_NAME}`;
    console.log(`  From: ${url}`);

    if (process.platform === 'darwin' || process.platform === 'linux') {
      execSync(`curl -L -o "${targetPath}" "${url}"`, { stdio: 'inherit' });
    } else {
      execSync(
        `powershell -Command "Invoke-WebRequest -Uri '${url}' -OutFile '${targetPath}'"`,
        { stdio: 'inherit' }
      );
    }
  }

  if (existsSync(targetPath)) {
    const mb = (require('fs').statSync(targetPath).size / 1024 / 1024).toFixed(0);
    console.log(`  ✓ Downloaded: ${targetPath} (${mb}MB)\n`);
  }
}

main().catch((err) => {
  console.error(`  ✗ Failed: ${err.message}`);
  process.exit(1);
});
