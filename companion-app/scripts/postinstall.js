#!/usr/bin/env node
/**
 * postinstall.js – Runs after `npm install` in the companion app.
 *
 * If whisper.cpp isn't set up yet, it shows instructions (or optionally
 * auto-clones & builds it).
 *
 * Set SKIP_WHISPER_SETUP=1 to bypass this check entirely.
 */

const { existsSync } = require('fs');
const { resolve } = require('path');
const { execSync } = require('child_process');

// Try loading .env if available
try {
  require('dotenv').config({ path: resolve(__dirname, '../.env') });
} catch { /* dotenv not yet installed */ }

const WHISPER_DIR = resolve(__dirname, '../node_modules', '.whisper');
const MAIN_EXEC = resolve(WHISPER_DIR, 'main');
const MODEL_DIR = resolve(WHISPER_DIR, 'models');
const MODEL_PATH = resolve(MODEL_DIR, 'ggml-base.en.bin');

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║        Live Translator Companion — Post-install         ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  // Check if whisper.cpp is already set up
  if (existsSync(MAIN_EXEC) && existsSync(MODEL_PATH)) {
    console.log('  ✓ whisper.cpp is already set up and ready.\n');
    return;
  }

  if (process.env.SKIP_WHISPER_SETUP === '1') {
    console.log('  SKIP_WHISPER_SETUP=1 — skipping whisper setup.');
    console.log('  Run `npm run setup-whisper` manually when ready.\n');
    return;
  }

  // Check if git is available
  try {
    execSync('git --version', { stdio: 'ignore' });
  } catch {
    console.log('  ⚠ git is required to set up whisper.cpp.');
    console.log('  Please install git, then run: npm run setup-whisper\n');
    return;
  }

  // Check if make is available
  try {
    execSync('make --version', { stdio: 'ignore' });
  } catch {
    console.log('  ⚠ make is required to build whisper.cpp.');
    console.log('  Please install build tools, then run: npm run setup-whisper\n');
    return;
  }

  console.log('  whisper.cpp is not yet set up.');
  console.log('');
  console.log('  To set it up automatically, run:');
  console.log('    npm run setup-whisper');
  console.log('');
  console.log('  This will:');
  console.log('    1. Clone whisper.cpp into ./node_modules/.whisper/');
  console.log('    2. Build the main binary');
  console.log('    3. Download the base.en model (~140MB)');
  console.log('');
  console.log('  Or skip this and configure manually via .env:\n');
  console.log('    LT_WHISPER_EXEC=./node_modules/.whisper/main');
  console.log('    LT_WHISPER_MODEL=./node_modules/.whisper/models/ggml-base.en.bin\n');
}

main().catch((err) => {
  console.error('postinstall error:', err.message);
});
