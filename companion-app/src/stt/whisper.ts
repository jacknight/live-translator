// =============================================================================
// Live Translator Companion – Whisper.cpp STT Engine
// =============================================================================
//
// Uses whisper.cpp's server mode to keep the model loaded between
// transcriptions. The server is spawned once and audio is sent via HTTP.
// =============================================================================

import { spawn, ChildProcess } from 'child_process';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { Logger } from '../utils/logger';

const logger = new Logger('WhisperSTT');

const SERVER_PORT = 8089;
const SERVER_START_TIMEOUT = 30000;

interface WhisperConfig {
  execPath: string;
  modelPath: string;
}

export class WhisperSTT {
  private config: WhisperConfig;
  private ready: boolean = false;
  private serverProc: ChildProcess | null = null;
  private tempDir: string = '';

  constructor(config: WhisperConfig) {
    this.config = config;
  }

  // --- Initialization -------------------------------------------------------
  async initialize(): Promise<void> {
    if (!existsSync(this.config.execPath)) {
      logger.warn(`whisper server binary not found at "${this.config.execPath}"`);
      return;
    }

    if (!existsSync(this.config.modelPath)) {
      logger.warn(`Whisper model not found at "${this.config.modelPath}"`);
      return;
    }

    this.tempDir = join(tmpdir(), 'live-translator-whisper');
    if (!existsSync(this.tempDir)) {
      mkdirSync(this.tempDir, { recursive: true });
    }

    await this.startServer();
  }

  private async startServer(): Promise<void> {
    const threads = require('os').cpus().length;

    const args = [
      '-m', this.config.modelPath,
      '--host', '127.0.0.1',
      '--port', String(SERVER_PORT),
      '-t', String(threads),
      '-l', 'auto',
      '-tr',
      '--no-fallback',
      '--no-timestamps',
    ];

    logger.info('Starting whisper server...');
    this.serverProc = spawn(this.config.execPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    this.serverProc.stderr?.on('data', (d: Buffer) => { stderr += d.toString('utf-8'); });

    this.serverProc.on('error', (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        logger.error(`Server binary not executable at "${this.config.execPath}"`);
      } else {
        logger.error(`Server failed to start: ${err.message}`);
      }
      this.ready = false;
    });

    this.serverProc.on('close', (code) => {
      logger.warn(`Whisper server exited with code ${code}. Restarting...`);
      this.ready = false;
      setTimeout(() => this.startServer(), 1000);
    });

    // Wait for server to be ready by polling the health endpoint
    const startTime = Date.now();
    while (Date.now() - startTime < SERVER_START_TIMEOUT) {
      try {
        const res = await fetch(`http://127.0.0.1:${SERVER_PORT}/`);
        if (res.ok) {
          this.ready = true;
          logger.info('STT ready (server mode)');
          return;
        }
      } catch {
        // Server not up yet
      }
      await new Promise(r => setTimeout(r, 200));
    }

    logger.error('Whisper server did not start within timeout');
    logger.error('Server stderr:', stderr.substring(0, 500));
    this.ready = false;
  }

  isReady(): boolean {
    return this.ready;
  }

  // --- Transcription --------------------------------------------------------
  async transcribe(audio: Float32Array, sampleRate: number): Promise<{ text: string; exitCode?: number }> {
    if (!this.ready) return { text: '', exitCode: -1 };

    try {
      const wavPath = await this.writeWavFile(audio, sampleRate);
      const wavData = readFileSync(wavPath);
      await unlink(wavPath).catch(() => {});

      // Build multipart form body manually to avoid Blob/FormData issues in Electron
      const boundary = '----WhisperBoundary' + Date.now();
      const header = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="audio.wav"',
        'Content-Type: audio/wav',
        '',
        '',
      ].join('\r\n');
      const footer = `\r\n--${boundary}--\r\n`;
      const body = Buffer.concat([
        Buffer.from(header, 'utf-8'),
        wavData,
        Buffer.from(footer, 'utf-8'),
      ]);

      const res = await fetch(`http://127.0.0.1:${SERVER_PORT}/inference`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body,
        signal: AbortSignal.timeout(600000),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`Server responded ${res.status}: ${errBody.substring(0, 200)}`);
      }

      const data = await res.json() as { text?: string };
      return { text: this.cleanTranscript(data.text || ''), exitCode: 0 };
    } catch (err) {
      logger.error('Transcription failed:', (err as Error).message);
      // Server might have died — try restarting
      this.ready = false;
      this.startServer();
      return { text: '', exitCode: -1 };
    }
  }

  // --- WAV file creation ----------------------------------------------------
  private async writeWavFile(audio: Float32Array, sampleRate: number): Promise<string> {
    const tempFile = join(this.tempDir, `audio-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);

    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const dataSize = audio.length * bitsPerSample / 8;

    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);

    const pcmData = Buffer.alloc(dataSize);
    for (let i = 0; i < audio.length; i++) {
      const s = Math.max(-1, Math.min(1, audio[i]));
      pcmData.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7FFF, i * 2);
    }

    await writeFile(tempFile, Buffer.concat([header, pcmData]));
    return tempFile;
  }

  // --- Transcript cleaning --------------------------------------------------
  private cleanTranscript(raw: string): string {
    let text = raw.trim();

    text = text.replace(/\([^)]*\)/g, '');
    text = text.replace(/\[SILENCE\]/gi, '');
    text = text.replace(/\[BLANK.AUDIO\]/gi, '');
    text = text.replace(/\[NO.SPEECH\]/gi, '');
    text = text.replace(/\*[^*]*\*/g, '');
    text = text.replace(/\b(uh+|um+|er+|ah+)\b/gi, '');
    text = text.replace(/\s{2,}/g, ' ');
    text = text.replace(/^[\s,.!?;:　]+/, '');
    text = text.replace(/[\s,.!?;:　]+$/, '');

    return text.trim();
  }

  // --- Model switching ------------------------------------------------------
  async setModelPath(newPath: string): Promise<void> {
    this.config.modelPath = newPath;
    logger.info(`Switching model: ${newPath}`);
    if (this.serverProc) {
      this.serverProc.kill();
      this.serverProc = null;
    }
    this.ready = false;
    await this.startServer();
  }

  // --- Cleanup --------------------------------------------------------------
  async cleanup(): Promise<void> {
    if (this.serverProc) {
      this.serverProc.kill();
      this.serverProc = null;
    }
  }
}
