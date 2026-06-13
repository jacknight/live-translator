// =============================================================================
// Live Translator Companion – Model Manager
// =============================================================================
//
// Handles listing, downloading, deleting, and switching whisper.cpp models.
// Models are stored in a configurable data directory (userData in packaged builds).
// =============================================================================

import { existsSync, readdirSync, statSync, unlinkSync, mkdirSync, copyFileSync, readFileSync } from 'fs';
import { resolve, join, basename, dirname } from 'path';
import { execSync } from 'child_process';
import { Logger } from '../utils/logger';
import { setConfig, getConfig } from '../config';

const logger = new Logger('Models');

let MODELS_DIR = resolve(__dirname, '../../node_modules/.whisper/models');
let WHISPER_DIR = resolve(__dirname, '../../node_modules/.whisper');
const HF_API = 'https://huggingface.co/api/models/ggerganov/whisper.cpp';

export function setDataDir(userDataPath: string) {
  MODELS_DIR = join(userDataPath, 'models');
  WHISPER_DIR = join(userDataPath, 'whisper');
  if (!existsSync(MODELS_DIR)) mkdirSync(MODELS_DIR, { recursive: true });
  if (!existsSync(WHISPER_DIR)) mkdirSync(WHISPER_DIR, { recursive: true });
  logger.info('Data dir:', userDataPath);
}

export interface ModelInfo {
  name: string;
  size: string;
  sizeBytes: number;
  downloaded: boolean;
  active: boolean;
  supportsTranslate: boolean;
}

const NO_TRANSLATE = new Set([
  'ggml-large-v3-turbo.bin',
  'ggml-large-v3-turbo-q5_0.bin',
  'ggml-large-v3-turbo-q8_0.bin',
]);

export async function fetchAvailableModels(): Promise<string[]> {
  try {
    const res = await fetch(`${HF_API}?sort=downloads&direction=-1`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: any = await res.json();
    const bins: string[] = [];
    for (const f of data.siblings || []) {
      const name: string = f.rfilename || '';
      if (name.endsWith('.bin') && name.startsWith('ggml-') && !name.startsWith('for-tests-') && !name.includes('-v2')) {
        bins.push(name);
      }
    }
    return bins.sort();
  } catch (err) {
    logger.warn('Failed to fetch model list:', (err as Error).message);
    return [];
  }
}

export function listLocalModels(): ModelInfo[] {
  const active = getConfig().whisperModelPath;
  if (!existsSync(MODELS_DIR)) {
    mkdirSync(MODELS_DIR, { recursive: true });
    return [];
  }
  return readdirSync(MODELS_DIR)
    .filter(f => f.endsWith('.bin') && !f.startsWith('for-tests-'))
    .map(f => {
      const fullPath = join(MODELS_DIR, f);
      return {
        name: f,
        size: formatBytes(statSync(fullPath).size),
        sizeBytes: statSync(fullPath).size,
        downloaded: true,
        active: resolve(active) === resolve(fullPath),
        supportsTranslate: !NO_TRANSLATE.has(f),
      };
    }).sort((a, b) => b.sizeBytes - a.sizeBytes);
}

export async function getFullModelList(): Promise<ModelInfo[]> {
  const local = listLocalModels();
  const localNames = new Set(local.map(m => m.name));

  // Fetch remote list with a short timeout; if it fails, just return local models
  let remote: string[] = [];
  try {
    remote = await fetchAvailableModels();
  } catch {
    // Ignore — local models are sufficient
  }

  const all: ModelInfo[] = [];

  for (const name of remote) {
    const localEntry = local.find(m => m.name === name);
    all.push(localEntry || {
      name, size: '', sizeBytes: 0, downloaded: false, active: false,
      supportsTranslate: !NO_TRANSLATE.has(name),
    });
  }
  for (const m of local) {
    if (!remote.includes(m.name)) all.push(m);
  }
  return all;
}

export async function downloadModel(name: string): Promise<void> {
  const target = join(MODELS_DIR, name);
  if (existsSync(target)) { logger.info(`Already downloaded: ${name}`); return; }
  if (!existsSync(MODELS_DIR)) mkdirSync(MODELS_DIR, { recursive: true });

  const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${name}`;
  logger.info(`Downloading ${name}...`);
  const curl = process.platform === 'win32' ? 'curl.exe' : 'curl';
  execSync(`${curl} -L -o "${target}" "${url}"`, { stdio: 'inherit', timeout: 600000 });
  logger.info(`Downloaded: ${name}`);
}

export function deleteModel(name: string): void {
  const target = join(MODELS_DIR, name);
  if (!existsSync(target)) return;
  const active = getConfig().whisperModelPath;
  if (resolve(active) === resolve(target)) {
    throw new Error('Cannot delete the active model. Switch to another model first.');
  }
  unlinkSync(target);
  logger.info(`Deleted: ${name}`);
}

export async function switchModel(name: string): Promise<void> {
  const target = join(MODELS_DIR, name);
  if (!existsSync(target)) throw new Error(`Model not downloaded: ${name}`);
  setConfig({ whisperModelPath: target });
  logger.info(`Switched to model: ${name}`);
}

export function getWhisperBinPath(): string {
  const serverName = process.platform === 'win32' ? 'whisper-server.exe' : 'whisper-server';
  const cliName = process.platform === 'win32' ? 'whisper.exe' : 'whisper';

  // Prefer the server binary — keeps model loaded between requests
  const candidates: string[] = [
    // Bundled (extraResources → process.resourcesPath/whisper/)
    ...(process.resourcesPath ? [join(process.resourcesPath, 'whisper', serverName)] : []),
    ...(process.resourcesPath ? [join(process.resourcesPath, 'whisper', 'whisper-server')] : []),
    // Downloaded at runtime into userData
    join(WHISPER_DIR, serverName),
    join(WHISPER_DIR, 'whisper-server'),
    // Dev paths
    resolve(__dirname, '../../whisper.cpp/build/bin/Release/whisper-server.exe'),
    resolve(__dirname, '../../whisper.cpp/build/bin/whisper-server'),
    // Fallback: CLI binary
    ...(process.resourcesPath ? [join(process.resourcesPath, 'whisper', cliName)] : []),
    ...(process.resourcesPath ? [join(process.resourcesPath, 'whisper', 'whisper')] : []),
    join(WHISPER_DIR, cliName),
    join(WHISPER_DIR, 'whisper'),
    resolve(__dirname, '../../node_modules/.whisper/main'),
    resolve(__dirname, '../../whisper.cpp/build/bin/Release/whisper-cli.exe'),
    resolve(__dirname, '../../whisper.cpp/build/bin/whisper-cli'),
    resolve(__dirname, '../../whisper.cpp/build/bin/main'),
  ];

  for (const p of candidates) {
    try {
      if (existsSync(p)) return p;
    } catch {}
  }

  return join(WHISPER_DIR, serverName);
}

// Minimum size for a valid whisper binary (100 KB). Anything smaller
// is almost certainly a 404 HTML page or corrupted download.
const MIN_BINARY_SIZE = 100 * 1024;

// Check the first bytes of a file to verify it's an executable for THIS platform.
// Prevents Mac binaries from being used on Windows and vice versa.
function isCorrectPlatformBinary(path: string): boolean {
  try {
    const fd = readFileSync(path, { flag: 'r' });
    const head = fd.toString('hex', 0, Math.min(4, fd.length));

    if (process.platform === 'win32') {
      // PE: starts with 'MZ' (4d5a)
      return head.startsWith('4d5a');
    }
    if (process.platform === 'darwin') {
      // Mach-O magic: feedfacf (64-bit), cefaedfe (fat), cafebabe (universal)
      return head === 'cffaedfe' || head === 'cefaedfe' || head === 'cafebabe' || head === 'feedfacf';
    }
    // Linux: ELF starts with 7f454c46
    if (process.platform === 'linux') {
      return head === '7f454c46';
    }
    return true; // unknown platform, can't check
  } catch {
    return false;
  }
}

function isValidBinary(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    const sz = statSync(path).size;
    if (sz < MIN_BINARY_SIZE) {
      logger.warn(`Binary at "${path}" is only ${sz} bytes — likely a corrupted download (404 HTML). Removing.`);
      try { unlinkSync(path); } catch {}
      return false;
    }
    if (!isCorrectPlatformBinary(path)) {
      logger.warn(`Binary at "${path}" is for a different platform. Skipping.`);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * On Windows, whisper.cpp binaries are often dynamically linked against
 * MinGW runtime DLLs that aren't included in the release zip.
 * Download them from the winlibs project if needed.
 */
async function ensureWindowsDlls(
  binPath: string,
  destDir: string,
  curlCmd: string
): Promise<boolean> {
  // Quick check: does the binary launch?
  try {
    execSync(`"${binPath}" --help`, { timeout: 10000, stdio: 'ignore' });
    return true; // Already works
  } catch {
    // Expected — DLLs likely missing
  }

  // Download MinGW runtime DLLs from winlibs
  const dllNames = [
    'libgcc_s_seh-1.dll',
    'libstdc++-6.dll',
    'libwinpthread-1.dll',
  ];

  logger.info('Downloading MinGW runtime DLLs...');
  let success = true;

  for (const dllName of dllNames) {
    const dllPath = join(destDir, dllName);
    if (existsSync(dllPath)) continue; // Already have it

    // winlibs hosts individual DLLs at predictable URLs
    const dllUrl =
      `https://github.com/brechtsanders/winlibs_mingw/releases/download/` +
      `14.2.0posix-19.1.1-16.0.0-msvcrt-r1/${dllName}`;

    try {
      execSync(`${curlCmd} -sfL -o "${dllPath}" "${dllUrl}"`,
        { timeout: 30000, stdio: 'ignore' });
      if (existsSync(dllPath) && statSync(dllPath).size > 1000) {
        logger.info(`  Downloaded: ${dllName}`);
      } else {
        if (existsSync(dllPath)) unlinkSync(dllPath);
        success = false;
      }
    } catch {
      success = false;
    }
  }

  // Verify again
  if (success) {
    try {
      execSync(`"${binPath}" --help`, { timeout: 10000, stdio: 'ignore' });
      logger.info('Binary launches successfully with DLLs');
      return true;
    } catch {
      logger.warn('Binary still fails — may need Visual C++ Redistributable');
      return false;
    }
  }

  return false;
}

export async function ensureWhisperBinary(): Promise<boolean> {
  const binPath = getWhisperBinPath();
  if (isValidBinary(binPath)) return true;

  if (!existsSync(WHISPER_DIR)) mkdirSync(WHISPER_DIR, { recursive: true });
  const zipPath = join(WHISPER_DIR, 'whisper.zip');

  // Try to download pre-built binary from the latest whisper.cpp release.
  // Uses GitHub API to find the correct asset for this platform + arch.
  const releaseUrl = 'https://api.github.com/repos/ggerganov/whisper.cpp/releases/latest';

  logger.info(`Finding latest whisper.cpp binary from ${releaseUrl}...`);
  try {
    // Fetch release metadata
    const curl = process.platform === 'win32' ? 'curl.exe' : 'curl';
    const releaseJson = execSync(
      `${curl} -sfL "${releaseUrl}"`,
      { timeout: 15000, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const release = JSON.parse(releaseJson);
    const tag = release.tag_name;
    logger.info(`Latest whisper.cpp release: ${tag}`);

    // Find matching asset — platform-specific patterns, excluding source archives
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const isSource = (name: string) => /source|src/i.test(name) || !/\.zip$/i.test(name);
    let assetUrl = '';
    let assetName = '';

    if (process.platform === 'win32') {
      // Windows: require 'win' or 'windows' in name, must be a .zip, not source
      const patterns = [
        new RegExp(`whisper.*win.*${arch}`, 'i'),
        new RegExp(`whisper.*${arch}.*win`, 'i'),
        new RegExp(`whisper.*win`, 'i'),
        new RegExp(`whisper.*windows`, 'i'),
      ];
      for (const p of patterns) {
        const asset = (release.assets || []).find((a: any) =>
          p.test(a.name) && !isSource(a.name)
        );
        if (asset) { assetUrl = asset.browser_download_url; assetName = asset.name; break; }
      }
    } else if (process.platform === 'darwin') {
      const patterns = [
        new RegExp(`whisper.*(mac|darwin).*${arch}`, 'i'),
        new RegExp(`whisper.*${arch}.*(mac|darwin)`, 'i'),
      ];
      for (const p of patterns) {
        const asset = (release.assets || []).find((a: any) =>
          p.test(a.name) && !isSource(a.name)
        );
        if (asset) { assetUrl = asset.browser_download_url; assetName = asset.name; break; }
      }
    } else {
      const patterns = [
        new RegExp(`whisper.*linux.*${arch}`, 'i'),
        new RegExp(`whisper.*${arch}.*linux`, 'i'),
      ];
      for (const p of patterns) {
        const asset = (release.assets || []).find((a: any) =>
          p.test(a.name) && !isSource(a.name)
        );
        if (asset) { assetUrl = asset.browser_download_url; assetName = asset.name; break; }
      }
    }

    if (!assetUrl) {
      logger.warn('No matching binary found in release assets');
      throw new Error('No matching asset');
    }

    logger.info(`Matched asset: ${assetName}`);

    // Download the zip
    execSync(`${curl} -sfL -o "${zipPath}" "${assetUrl}"`, { timeout: 120000 });

    // Extract zip — PowerShell on Windows, unzip elsewhere
    const binaryNames = ['whisper.exe', 'whisper-cli.exe', 'main.exe', 'whisper', 'whisper-cli', 'main'];
    if (process.platform === 'win32') {
      execSync(
        `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${WHISPER_DIR}' -Force"`,
        { stdio: 'inherit', timeout: 120000 }
      );
    } else {
      execSync(`unzip -o "${zipPath}" -d "${WHISPER_DIR}"`, { stdio: 'inherit', timeout: 120000 });
    }

    unlinkSync(zipPath);

    // Search recursively for a binary in the extracted contents.
    // Also collect all sibling files (DLLs, etc.) to copy alongside it.
    function findBinary(dir: string): string | null {
      try {
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry);
          if (binaryNames.includes(entry) && statSync(full).isFile()) {
            return full;
          }
          if (statSync(full).isDirectory()) {
            const found = findBinary(full);
            if (found) return found;
          }
        }
      } catch {}
      return null;
    }

    const foundBinary = findBinary(WHISPER_DIR);
    if (foundBinary) {
      const foundDir = dirname(foundBinary);
      // Copy the binary AND all sibling files (DLLs) to WHISPER_DIR
      try {
        for (const entry of readdirSync(foundDir)) {
          const src = join(foundDir, entry);
          const dst = join(WHISPER_DIR, entry);
          if (statSync(src).isFile() && resolve(src) !== resolve(dst)) {
            copyFileSync(src, dst);
            logger.info(`Copied: ${entry}`);
          }
        }
      } catch {}
      // Ensure the canonical binary name exists
      if (!existsSync(binPath)) {
        const binName = basename(foundBinary);
        const srcAtRoot = join(WHISPER_DIR, binName);
        if (existsSync(srcAtRoot)) {
          copyFileSync(srcAtRoot, binPath);
        }
      }
      if (process.platform !== 'win32') {
        try { execSync(`chmod +x "${binPath}"`, { stdio: 'ignore' }); } catch {}
      }
    }

    // After extraction, re-run getWhisperBinPath to pick up the canonical location
    const actualPath = getWhisperBinPath();
    if (!isValidBinary(actualPath)) {
      throw new Error('No valid binary found after extraction');
    }
    logger.info(`Binary ready at "${actualPath}" (${(statSync(actualPath).size / 1024 / 1024).toFixed(1)} MB)`);

    // On Windows, verify the binary actually launches — whisper.cpp binaries
    // are often dynamically linked against MinGW DLLs that aren't in the zip.
    if (process.platform === 'win32') {
      const dllOk = await ensureWindowsDlls(actualPath, WHISPER_DIR, curl);
      if (!dllOk) {
        // DLL install failed — let pre-warm handle the rejection
        logger.warn('MinGW DLL setup may not have succeeded; STT pre-warm will verify');
      }
    }

    return true;
  } catch (e) {
    logger.warn('Download failed:', (e as Error).message);
  }

  // Clean up any leftover partial download
  if (existsSync(zipPath)) {
    try { unlinkSync(zipPath); } catch {}
  }

  // Fallback: compile from source (macOS/Linux have cmake)
  logger.info('Compiling whisper.cpp from source...');
  const srcDir = resolve(__dirname, '../../whisper.cpp');
  if (existsSync(join(srcDir, 'CMakeLists.txt'))) {
    try {
      execSync(`cmake -S "${srcDir}" -B "${srcDir}/build" -DCMAKE_BUILD_TYPE=Release`, { stdio: 'inherit', timeout: 120000 });
      execSync(`cmake --build "${srcDir}/build" -j${require('os').cpus().length}`, { stdio: 'inherit', timeout: 300000 });
      const candidates = [resolve(srcDir, 'build/bin/whisper-cli'), resolve(srcDir, 'build/bin/main'), resolve(srcDir, 'build/main')];
      for (const f of candidates) {
        if (existsSync(f)) { copyFileSync(f, binPath); try { execSync(`chmod +x "${binPath}"`, { stdio: 'ignore' }); } catch {} break; }
      }
      const actualPath = getWhisperBinPath();
      if (isValidBinary(actualPath)) { logger.info('Binary compiled from source'); return true; }
    } catch (e) { logger.error('Compile failed:', (e as Error).message); }
  } else {
    logger.error('No whisper.cpp source found at', srcDir);
  }

  return false;
}

export async function ensureDefaultModel(): Promise<void> {
  // If there's a previously selected model, restore it
  if (loadActiveModel()) return;

  if (!existsSync(MODELS_DIR)) mkdirSync(MODELS_DIR, { recursive: true });
  const files = readdirSync(MODELS_DIR).filter(f => f.endsWith('.bin') && !f.startsWith('for-tests-'));
  if (files.length > 0) {
    // Pick the largest one
    const largest = files.sort((a, b) => statSync(join(MODELS_DIR, b)).size - statSync(join(MODELS_DIR, a)).size)[0];
    await switchModel(largest);
    logger.info(`Auto-selected existing model: ${largest}`);
    return;
  }
  logger.info('No models found, downloading base.en (~141MB)...');
  await downloadModel('ggml-base.en.bin');
  await switchModel('ggml-base.en.bin');
}

/**
 * Restore the previously selected model from config.json.
 */
export function loadActiveModel(): string | null {
  const modelPath = getConfig().whisperModelPath;
  if (modelPath && existsSync(modelPath)) {
    const name = basename(modelPath);
    logger.info(`Restored active model: ${name}`);
    return name;
  }
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + u[i];
}
