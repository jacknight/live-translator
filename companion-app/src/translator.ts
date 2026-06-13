// =============================================================================
// Live Translator Companion – Translation Engine
// =============================================================================
//
// Supports multiple translation backends:
//   1. Local: Bergamot / Marian (via subprocess)
//   2. Local: LibreTranslate (via HTTP API if running locally)
//   3. Cloud: Google Cloud Translation, DeepL, etc. (falls back if configured)
//   4. Null: Returns the input text unchanged (for testing / same-language)
//
// The user can configure which backend to use via environment variables.
// =============================================================================

import { Logger } from './utils/logger';

const logger = new Logger('Translator');

type BackendType = 'null' | 'libretranslate' | 'bergamot' | 'deepl' | 'google';

interface TranslatorConfig {
  sourceLanguage: string;
  targetLanguage: string;
  backend?: BackendType;
  apiKey?: string;
  apiUrl?: string;
}

interface TranslationResult {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  confidence?: number;
}

export class Translator {
  private config: TranslatorConfig;
  private ready: boolean = false;

  constructor(config: Partial<TranslatorConfig> = {}) {
    this.config = {
      sourceLanguage: config.sourceLanguage || 'auto',
      targetLanguage: config.targetLanguage || 'en',
      backend: (config.backend as BackendType) || this.detectBackend(),
      apiKey: config.apiKey || process.env.LT_TRANSLATOR_API_KEY || '',
      apiUrl: config.apiUrl || process.env.LT_TRANSLATOR_API_URL || 'http://127.0.0.1:5000',
    };
  }

  private detectBackend(): BackendType {
    // Check environment for configured backend
    const envBackend = process.env.LT_TRANSLATOR_BACKEND;
    if (envBackend && ['null', 'libretranslate', 'bergamot', 'deepl', 'google'].includes(envBackend)) {
      return envBackend as BackendType;
    }

    // Default to 'null' (passthrough) until user configures a backend
    return 'null';
  }

  async initialize(): Promise<void> {
    logger.info(
      `Translation backend: ${this.config.backend} ` +
      `(${this.config.sourceLanguage} → ${this.config.targetLanguage})`
    );

    switch (this.config.backend) {
      case 'libretranslate':
        this.ready = await this.checkLibreTranslate();
        break;
      case 'bergamot':
        this.ready = await this.checkBergamot();
        break;
      case 'deepl':
      case 'google':
        this.ready = !!this.config.apiKey;
        if (!this.ready) {
          logger.warn(`${this.config.backend} requires an API key (LT_TRANSLATOR_API_KEY)`);
        }
        break;
      case 'null':
      default:
        this.ready = true;
        logger.info('Using null translator (passthrough — install a translation backend for real translations)');
        break;
    }

    if (!this.ready) {
      logger.warn('Translation backend not available. Falling back to null (passthrough).');
      this.config.backend = 'null';
      this.ready = true;
    }
  }

  /**
   * Translate text from source language to target language.
   */
  async translate(text: string): Promise<string> {
    if (!text || text.trim().length === 0) return '';

    try {
      let result: TranslationResult;

      switch (this.config.backend) {
        case 'libretranslate':
          result = await this.translateLibreTranslate(text);
          break;
        case 'deepl':
          result = await this.translateDeepL(text);
          break;
        case 'google':
          result = await this.translateGoogle(text);
          break;
        case 'null':
        default:
          result = { text, sourceLanguage: this.config.sourceLanguage, targetLanguage: this.config.targetLanguage };
          break;
      }

      return result.text;
    } catch (err) {
      logger.error('Translation failed:', err);
      return text; // Return original text on failure
    }
  }

  // --- Backend Implementations ----------------------------------------------

  private async translateLibreTranslate(text: string): Promise<TranslationResult> {
    // LibreTranslate API: POST /translate
    const response = await fetch(`${this.config.apiUrl}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: text,
        source: this.config.sourceLanguage === 'auto' ? 'auto' : this.config.sourceLanguage,
        target: this.config.targetLanguage,
        format: 'text',
      }),
    });

    if (!response.ok) {
      throw new Error(`LibreTranslate HTTP ${response.status}: ${await response.text()}`);
    }

    const data = await response.json() as { translatedText: string };
    return {
      text: data.translatedText,
      sourceLanguage: this.config.sourceLanguage,
      targetLanguage: this.config.targetLanguage,
    };
  }

  private async translateDeepL(text: string): Promise<TranslationResult> {
    // DeepL API v2: POST /v2/translate
    const response = await fetch('https://api-free.deepl.com/v2/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `DeepL-Auth-Key ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        text: [text],
        source_lang: this.config.sourceLanguage === 'auto' ? undefined : this.config.sourceLanguage.toUpperCase(),
        target_lang: this.config.targetLanguage.toUpperCase(),
      }),
    });

    if (!response.ok) {
      throw new Error(`DeepL HTTP ${response.status}: ${await response.text()}`);
    }

    const data = await response.json() as { translations: Array<{ text: string }> };
    return {
      text: data.translations[0]?.text || text,
      sourceLanguage: this.config.sourceLanguage,
      targetLanguage: this.config.targetLanguage,
    };
  }

  private async translateGoogle(text: string): Promise<TranslationResult> {
    // Google Cloud Translation API v3: POST /v3/projects/.../locations/.../translateText
    // This is a simplified version. In production, use the @google-cloud/translate package.
    const projectId = process.env.GOOGLE_PROJECT_ID || '';
    const location = 'global';

    const response = await fetch(
      `https://translation.googleapis.com/v3/projects/${projectId}/locations/${location}:translateText`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          contents: [text],
          sourceLanguageCode: this.config.sourceLanguage === 'auto' ? undefined : this.config.sourceLanguage,
          targetLanguageCode: this.config.targetLanguage,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Google Translate HTTP ${response.status}: ${await response.text()}`);
    }

    const data = await response.json() as { translations: Array<{ translatedText: string }> };
    return {
      text: data.translations[0]?.translatedText || text,
      sourceLanguage: this.config.sourceLanguage,
      targetLanguage: this.config.targetLanguage,
    };
  }

  // --- Health Checks --------------------------------------------------------

  private async checkLibreTranslate(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.apiUrl}/languages`, {
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      logger.warn(`LibreTranslate not reachable at ${this.config.apiUrl}`);
      return false;
    }
  }

  private async checkBergamot(): Promise<boolean> {
    // Bergamot translator runs as a local subprocess
    // Simplified check — just verify the executable exists
    const { existsSync } = await import('fs');
    const bergamotPath = process.env.LT_BERGAMOT_PATH || './bergamot';
    return existsSync(bergamotPath);
  }

  // --- Public API -----------------------------------------------------------

  getSourceLanguage(): string {
    return this.config.sourceLanguage;
  }

  getTargetLanguage(): string {
    return this.config.targetLanguage;
  }

  setTargetLanguage(lang: string): void {
    this.config.targetLanguage = lang;
    logger.info(`Target language changed to: ${lang}`);
  }

  setSourceLanguage(lang: string): void {
    this.config.sourceLanguage = lang;
    logger.info(`Source language changed to: ${lang}`);
  }

  cleanup(): void {
    // Nothing to clean up for current backends
  }
}
