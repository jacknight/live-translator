// =============================================================================
// Live Translator Companion – Configuration
// =============================================================================
//
// All persistent state lives in a single JSON file:
//   macOS: ~/Library/Application Support/Live Translator Companion/config.json
//   Linux: ~/.config/Live Translator Companion/config.json
//   Windows: %APPDATA%/Live Translator Companion/config.json
//
// In development, we also load .env for convenience (LT_LOG_LEVEL, etc.).
// =============================================================================

import * as dotenv from 'dotenv';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

// Load .env for dev convenience (log level, etc.)
dotenv.config({ path: resolve(__dirname, '../../.env') });

export interface Config {
  wsHost: string;
  wsPort: number;
  whisperExecPath: string;
  whisperModelPath: string;
  sourceLanguage: string;
  targetLanguage: string;
  translatorBackend: 'null' | 'libretranslate' | 'deepl' | 'google';
  translatorApiUrl: string;
  translatorApiKey: string;
  logLevel: string;
}

const DEFAULTS: Config = {
  wsHost: '127.0.0.1',
  wsPort: 9876,
  whisperExecPath: '',
  whisperModelPath: '',
  sourceLanguage: 'auto',
  targetLanguage: 'en',
  translatorBackend: 'null',
  translatorApiUrl: 'http://127.0.0.1:5000',
  translatorApiKey: '',
  logLevel: 'info',
};

let _config: Config | null = null;
let _configPath = '';

/**
 * Set the path to the config file (called after app.whenReady()).
 */
export function setConfigDir(userDataPath: string) {
  const dir = resolve(userDataPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  _configPath = resolve(dir, 'config.json');
  _config = null; // force reload
}

function loadFromDisk(): Config {
  if (!_configPath || !existsSync(_configPath)) {
    return { ...DEFAULTS };
  }
  try {
    const raw = readFileSync(_configPath, 'utf-8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveToDisk(cfg: Config) {
  if (!_configPath) return;
  try {
    const dir = dirname(_configPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(_configPath, JSON.stringify(cfg, null, 2), 'utf-8');
  } catch {}
}

export function getConfig(): Config {
  if (!_config) {
    _config = loadFromDisk();
    // Override log level from env if set (dev convenience)
    if (process.env.LT_LOG_LEVEL) _config.logLevel = process.env.LT_LOG_LEVEL;
  }
  return _config;
}

export function setConfig(partial: Partial<Config>): Config {
  _config = { ...getConfig(), ...partial };
  saveToDisk(_config);
  return _config;
}
