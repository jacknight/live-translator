#!/usr/bin/env node
/**
 * setup-whisper.js – Installs whisper.cpp into node_modules/.whisper/
 *                    as an npm-managed local dependency.
 *
 * Usage:  npm run setup-whisper
 *
 * Environment variables:
 *   LT_WHISPER_MODEL_SIZE   Model to download (default: base.en)
 *                           Options: tiny, tiny.en, base, base.en, small, small.en,
 *                                    medium, medium.en, large-v3
 *
 * This script:
 *   1. Clones whisper.cpp into ./node_modules/.whisper/
 *   2. Builds the main binary with `make -j`
 *   3. Downloads the specified GGML model
 *   4. Symlinks main into ./node_modules/.bin/whisper
 *   5. Writes correct paths to .env (creates or updates in-place)
 *   6. Verifies the binary and model actually exist before declaring success
 */

const { existsSync, symlinkSync } = require('fs');
const { resolve } = require('path');
const { execSync } = require('child_process');
const { readFileSync, writeFileSync, mkdirSync } = require('fs');

const ROOT = resolve(__dirname, '..');
const WHISPER_DIR = resolve(ROOT, 'node_modules', '.whisper');
const BIN_DIR = resolve(ROOT, 'node_modules', '.bin');
const MODEL_SIZE = process.env.LT_WHISPER_MODEL_SIZE || 'base.en';
const MODEL_NAME = `ggml-${MODEL_SIZE}.bin`;
const MODEL_DIR = resolve(WHISPER_DIR, 'models');
const MODEL_PATH = resolve(MODEL_DIR, MODEL_NAME);
const MAIN_BIN = resolve(WHISPER_DIR, 'main');

let errors = 0;

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║     Setting up whisper.cpp for Live Translator         ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  // Ensure node_modules directories exist
  if (!existsSync(resolve(ROOT, 'node_modules'))) {
    mkdirSync(resolve(ROOT, 'node_modules'), { recursive: true });
  }

  // ── 1. Clone whisper.cpp into node_modules/.whisper ─────────────────
  if (!existsSync(WHISPER_DIR)) {
    console.log('  [1/6] Cloning whisper.cpp into node_modules/.whisper/...');
    execSync(
      `git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git "${WHISPER_DIR}"`,
      { stdio: 'inherit' }
    );
    console.log('  ✓ Cloned\n');
  } else {
    console.log('  [1/6] Already cloned, pulling latest...');
    execSync('git pull', { cwd: WHISPER_DIR, stdio: 'inherit' });
    console.log('  ✓ Updated\n');
  }

  // ── 2. Build ──────────────────────────────────────────────────────────
  console.log('  [2/6] Building whisper.cpp...');

  const numCpus = Math.max(1, require('os').cpus().length);

  // Detect available build tools
  let hasCmake = false;
  try {
    execSync('cmake --version', { stdio: 'ignore' });
    hasCmake = true;
  } catch { /* cmake not available */ }

  if (hasCmake) {
    // CMake build (recommended for modern whisper.cpp)
    console.log('  Using CMake...');
    if (process.platform === 'darwin') {
      console.log('  (Tip: brew install libomp to enable OpenMP acceleration)');
    } else if (process.platform === 'linux') {
      console.log('  (Tip: apt install libomp-dev to enable OpenMP acceleration)');
    }

    try {
      execSync(`cmake -S "${WHISPER_DIR}" -B "${WHISPER_DIR}/build" -DCMAKE_BUILD_TYPE=Release`, { stdio: 'inherit' });
      execSync(`cmake --build "${WHISPER_DIR}/build" -j${numCpus}`, { stdio: 'inherit' });

      // Find the built binary — newer whisper.cpp builds whisper-cli,
      // older ones build main. Search both names and common output dirs.
      const binaryNames = ['whisper-cli', 'main', 'whisper-cli.exe', 'main.exe'];
      const searchDirs = ['bin', '.', 'Release', 'Debug'];
      const cmakeCandidates = searchDirs.flatMap(dir =>
        binaryNames.map(name => resolve(WHISPER_DIR, 'build', dir, name))
      );

      let cmakeBin = cmakeCandidates.find(c => existsSync(c));

      // Broader search: look for any ELF/PE binary in build/
      if (!cmakeBin) {
        const { execSync: findExec } = require('child_process');
        try {
          const found = findExec(
            `find "${WHISPER_DIR}/build" -type f \\( -name 'whisper-cli' -o -name 'main' -o -name 'whisper-cli.exe' -o -name 'main.exe' \\) 2>/dev/null | head -1`,
            { encoding: 'utf-8', stdio: 'pipe' }
          ).toString().trim();
          if (found) cmakeBin = found;
        } catch { /* find not available */ }
      }

      // Last resort: any file in build/bin or build/ that looks executable
      if (!cmakeBin) {
        const binDir = resolve(WHISPER_DIR, 'build', 'bin');
        if (existsSync(binDir)) {
          const files = require('fs').readdirSync(binDir);
          const exe = files.find(f => f === 'whisper-cli' || f === 'main' || f.endsWith('.exe'));
          if (exe) cmakeBin = resolve(binDir, exe);
        }
      }

      if (cmakeBin) {
        const { copyFileSync } = require('fs');
        copyFileSync(cmakeBin, MAIN_BIN);
        console.log(`  ✓ Binary found at ${cmakeBin}, linked to ${MAIN_BIN}`);
      } else {
        throw new Error('Binary not found after cmake build. Searched: ' + cmakeCandidates.length + ' paths');
      }
    } catch (e) {
      console.log('  ⚠ CMake build failed:', e.message);
      console.log('  Falling back to Make...');
      hasCmake = false; // fall through to make
    }
  }

  if (!hasCmake) {
    // Make build (legacy fallback)
    console.log('  Using Make...');
    try {
      execSync(`make -j${numCpus} -C "${WHISPER_DIR}"`, { stdio: 'inherit' });
    } catch {
      console.log('  ⚠ Parallel make failed, retrying serial...');
      try {
        execSync(`make -C "${WHISPER_DIR}"`, { stdio: 'inherit' });
      } catch (e) {
        console.log('  ✗ Make build also failed:', e.message);
        errors++;
      }
    }
  }

  // Verify binary was produced
  if (!existsSync(MAIN_BIN)) {
    console.error('  ✗ Build failed: main binary not produced at', MAIN_BIN);
    errors++;
  } else {
    console.log('  ✓ Built:', MAIN_BIN, '\n');
  }

  // ── 3. Download model ─────────────────────────────────────────────────
  console.log('  [3/6] Downloading model:', MODEL_SIZE);

  const modelScript = resolve(WHISPER_DIR, 'models/download-ggml-model.sh');

  if (existsSync(modelScript)) {
    execSync(`bash "${modelScript}" ${MODEL_SIZE}`, {
      cwd: MODEL_DIR,
      stdio: 'inherit',
    });
  } else {
    const modelUrl = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_NAME}`;
    console.log(`  Downloading from ${modelUrl}...`);

    if (!existsSync(MODEL_DIR)) {
      mkdirSync(MODEL_DIR, { recursive: true });
    }

    if (process.platform === 'darwin' || process.platform === 'linux') {
      execSync(`curl -L -o "${MODEL_PATH}" "${modelUrl}"`, { stdio: 'inherit' });
    } else {
      execSync(
        `powershell -Command "Invoke-WebRequest -Uri '${modelUrl}' -OutFile '${MODEL_PATH}'"`,
        { stdio: 'inherit' }
      );
    }
  }

  if (!existsSync(MODEL_PATH)) {
    console.error('  ✗ Download failed: model not found at', MODEL_PATH);
    errors++;
  } else {
    const mb = (require('fs').statSync(MODEL_PATH).size / 1024 / 1024).toFixed(0);
    console.log(`  ✓ Downloaded: ${MODEL_NAME} (${mb}MB)\n`);
  }

  // ── 4. Symlink into node_modules/.bin ─────────────────────────────────
  console.log('  [4/6] Linking whisper binary to node_modules/.bin/...');

  if (existsSync(MAIN_BIN)) {
    if (!existsSync(BIN_DIR)) {
      mkdirSync(BIN_DIR, { recursive: true });
    }
    const linkPath = resolve(BIN_DIR, 'whisper');
    try {
      // Remove stale symlink first
      if (existsSync(linkPath)) {
        const { unlinkSync } = require('fs');
        unlinkSync(linkPath);
      }
      symlinkSync(MAIN_BIN, linkPath);
      console.log('  ✓ Linked ./node_modules/.bin/whisper\n');
    } catch (err) {
      console.log('  ⚠ Could not link:', err.message, '\n');
    }
  }

  // ── 5. Write / update .env with correct paths ────────────────────────
  //     Unlike before, this ALWAYS ensures the paths are correct,
  //     even if .env already exists with stale values.
  console.log('  [5/6] Writing paths to .env...');

  const envPath = resolve(ROOT, '.env');
  const envExample = resolve(ROOT, '.env.example');
  let envContent = '';

  if (existsSync(envPath)) {
    // Read existing .env and update the whisper vars in-place
    envContent = readFileSync(envPath, 'utf-8');

    const setOrAdd = (key, value) => {
      const re = new RegExp(`^${key}=.*`, 'm');
      if (re.test(envContent)) {
        envContent = envContent.replace(re, `${key}=${value}`);
      } else {
        envContent += `\n${key}=${value}`;
      }
    };

    setOrAdd('LT_WHISPER_EXEC', './node_modules/.whisper/main');
    setOrAdd('LT_WHISPER_MODEL', `./node_modules/.whisper/models/${MODEL_NAME}`);
    setOrAdd('LT_WHISPER_MODEL_SIZE', MODEL_SIZE);

    writeFileSync(envPath, envContent);
    console.log('  ✓ Updated .env with current build paths\n');
  } else if (existsSync(envExample)) {
    // Create from example
    envContent = readFileSync(envExample, 'utf-8')
      .replace(/^LT_WHISPER_EXEC=.*$/m, 'LT_WHISPER_EXEC=./node_modules/.whisper/main')
      .replace(/^LT_WHISPER_MODEL=.*$/m, `LT_WHISPER_MODEL=./node_modules/.whisper/models/${MODEL_NAME}`)
      .replace(/^LT_WHISPER_MODEL_SIZE=.*$/m, `LT_WHISPER_MODEL_SIZE=${MODEL_SIZE}`);

    writeFileSync(envPath, envContent);
    console.log('  ✓ Created .env with paths to npm-managed build\n');
  } else {
    console.log('  ⚠ No .env.example found, writing minimal .env\n');
    writeFileSync(envPath, [
      'LT_WHISPER_EXEC=./node_modules/.whisper/main',
      `LT_WHISPER_MODEL=./node_modules/.whisper/models/${MODEL_NAME}`,
      `LT_WHISPER_MODEL_SIZE=${MODEL_SIZE}`,
      '',
    ].join('\n'));
  }

  // ── 6. Final verification ─────────────────────────────────────────────
  console.log('  [6/6] Verifying installation...');

  let allOk = true;

  if (!existsSync(MAIN_BIN)) {
    console.error('  ✗ Binary missing:', MAIN_BIN);
    allOk = false;
  } else {
    console.log('  ✓ Binary:', MAIN_BIN);
  }

  if (!existsSync(MODEL_PATH)) {
    console.error('  ✗ Model missing:', MODEL_PATH);
    allOk = false;
  } else {
    console.log('  ✓ Model:', MODEL_PATH);
  }

  const envContents = readFileSync(envPath, 'utf-8');
  const execLine = envContents.split('\n').find(l => l.startsWith('LT_WHISPER_EXEC='));
  const modelLine = envContents.split('\n').find(l => l.startsWith('LT_WHISPER_MODEL='));
  console.log('  ✓ .env:', execLine || '(missing)');
  console.log('  ✓ .env:', modelLine || '(missing)');

  // ── Done ──────────────────────────────────────────────────────────────
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');

  if (allOk) {
    console.log('║      ✅  whisper.cpp setup complete!                     ║');
    console.log('║                                                        ║');
    console.log('║  Installed:  ./node_modules/.whisper/                   ║');
    console.log('║  Binary:     ./node_modules/.whisper/main               ║');
    console.log('║  Model:      ./node_modules/.whisper/models/            ║');
    console.log('║  Symlink:    ./node_modules/.bin/whisper                ║');
    console.log('║                                                        ║');
    console.log('║  Run:  npm start                                        ║');
    console.log('║  Or:   npm run electron:start                           ║');
  } else {
    console.log('║      ❌  Setup failed — see errors above                 ║');
    console.log('║                                                        ║');
    console.log('║  Check the error messages above and fix the issue,     ║');
    console.log('║  then run:  npm run setup-whisper                       ║');
  }

  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  if (!allOk || errors > 0) process.exit(1);
}

main().catch((err) => {
  console.error('  ✗ Setup failed:', err.message);
  process.exit(1);
});
