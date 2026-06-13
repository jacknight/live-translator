// =============================================================================
// Live Translator Companion – WebSocket Server
// =============================================================================

import { WebSocketServer as WSServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { WhisperSTT } from './stt/whisper';
import { Translator } from './translator';
import { getFullModelList, downloadModel, deleteModel, switchModel } from './main/model-manager';
import { getConfig } from './config';
import { Logger } from './utils/logger';

const logger = new Logger('WebSocket');

interface ServerConfig {
  wsHost: string;
  port: number;
  stt: WhisperSTT;
  translator: Translator;
}

interface ClientState {
  ws: WebSocket;
  config: {
    sourceLanguage: string;
    targetLanguage: string;
  };
  audioBuffer: Buffer[];
  isProcessing: boolean;
}

export class WebSocketServer {
  private wss: WSServer | null = null;
  private clients: Map<WebSocket, ClientState> = new Map();
  private config: ServerConfig;

  constructor(config: ServerConfig) {
    this.config = config;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const httpServer = createServer();
      this.wss = new WSServer({ server: httpServer });

      this.wss.on('connection', (ws: WebSocket) => {
        this.handleConnection(ws);
      });

      httpServer.listen(this.config.port, this.config.wsHost || '127.0.0.1', () => {
        resolve();
      });

      httpServer.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Port ${this.config.port} is already in use. Change the port in Settings.`));
        } else if (err.code === 'EACCES') {
          reject(new Error(`Permission denied for port ${this.config.port}. Use a port > 1024.`));
        } else {
          reject(err);
        }
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.clients.forEach((state) => {
        if (state.ws.readyState === WebSocket.OPEN) {
          state.ws.close();
        }
      });
      this.clients.clear();

      if (this.wss) {
        this.wss.close(() => {
          this.wss = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  broadcast(message: object): void {
    const data = JSON.stringify(message);
    this.clients.forEach((state) => {
      if (state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(data);
      }
    });
  }

  // --- Connection Handling --------------------------------------------------
  private handleConnection(ws: WebSocket): void {
    logger.info('Client connected');

    const state: ClientState = {
      ws,
      config: {
        sourceLanguage: this.config.translator.getSourceLanguage(),
        targetLanguage: this.config.translator.getTargetLanguage(),
      },
      audioBuffer: [],
      isProcessing: false,
    };

    this.clients.set(ws, state);

    this.sendTo(ws, {
      type: 'status',
      status: 'connected',
      stt: this.config.stt.isReady() ? 'ready' : 'loading',
    });

    ws.on('message', (data: Buffer) => {
      this.handleMessage(ws, state, data);
    });

    ws.on('close', () => {
      logger.info('Client disconnected');
      this.clients.delete(ws);
    });

    ws.on('error', (err) => {
      logger.error('WebSocket error:', err);
      this.clients.delete(ws);
    });
  }

  private async handleMessage(
    ws: WebSocket,
    state: ClientState,
    data: Buffer
  ): Promise<void> {
    try {
      if (this.isJSONMessage(data)) {
        const msg = JSON.parse(data.toString('utf-8'));
        await this.handleJSONMessage(ws, state, msg);
      } else {
        await this.handleAudioData(state, data);
      }
    } catch (err) {
      logger.error('Error handling message:', err);
      this.sendTo(ws, { type: 'error', message: 'Failed to process message' });
    }
  }

  private isJSONMessage(data: Buffer): boolean {
    return data.length > 0 && data[0] === 0x7b;
  }

  private async handleJSONMessage(
    ws: WebSocket,
    state: ClientState,
    msg: any
  ): Promise<void> {
    switch (msg.type) {
      case 'ping':
        this.sendTo(ws, { type: 'pong' });
        break;

      case 'get_status':
        this.sendTo(ws, {
          type: 'status',
          status: 'running',
          stt: this.config.stt.isReady() ? 'ready' : 'unavailable',
          model: getConfig().whisperModelPath || '',
        });
        break;

      case 'config':
        state.config.sourceLanguage = msg.sourceLanguage || state.config.sourceLanguage;
        state.config.targetLanguage = msg.targetLanguage || state.config.targetLanguage;
        this.config.translator.setTargetLanguage(state.config.targetLanguage);
        this.sendTo(ws, {
          type: 'status',
          status: 'configured',
          sourceLanguage: state.config.sourceLanguage,
          targetLanguage: state.config.targetLanguage,
        });
        break;

      case 'stop':
        state.audioBuffer = [];
        break;

      case 'list_models':
        try {
          this.sendTo(ws, { type: 'model_list', models: await getFullModelList() });
        } catch (err) {
          this.sendTo(ws, { type: 'error', message: (err as Error).message });
        }
        break;

      case 'download_model':
        try {
          await downloadModel(msg.name);
          this.sendTo(ws, { type: 'model_list', models: await getFullModelList() });
        } catch (err) {
          this.sendTo(ws, { type: 'error', message: (err as Error).message });
        }
        break;

      case 'delete_model':
        try {
          await deleteModel(msg.name);
          this.sendTo(ws, { type: 'model_list', models: await getFullModelList() });
        } catch (err) {
          this.sendTo(ws, { type: 'error', message: (err as Error).message });
        }
        break;

      case 'switch_model':
        try {
          await switchModel(msg.name);
          this.sendTo(ws, { type: 'model_list', models: await getFullModelList() });
          this.sendTo(ws, { type: 'status', status: 'model_changed' });
        } catch (err) {
          this.sendTo(ws, { type: 'error', message: (err as Error).message });
        }
        break;

      default:
        this.sendTo(ws, { type: 'error', message: `Unknown message type: ${msg.type}` });
    }
  }

  // --- Audio Processing -----------------------------------------------------
  private async handleAudioData(state: ClientState, data: Buffer): Promise<void> {
    if (data.length < 4) return;

    const sampleRate = data.readUInt32LE(0);
    const pcmData = data.subarray(4);

    state.audioBuffer.push(pcmData);

    if (!state.isProcessing) {
      this.processAudioBuffer(state, sampleRate);
    }
  }

  private async processAudioBuffer(state: ClientState, sampleRate: number): Promise<void> {
    if (state.isProcessing) return;
    state.isProcessing = true;

    try {
      const chunkSecs = 5;
      const chunkSamples = sampleRate * chunkSecs;
      let totalSamples = 0;
      for (const buf of state.audioBuffer) {
        totalSamples += buf.length / 2;
      }

      if (totalSamples < chunkSamples) {
        state.isProcessing = false;
        return;
      }

      // Slice exactly chunkSecs seconds from the front, leave the rest for next cycle
      let remainingBytes = chunkSamples * 2;
      const chunkBuffers: Buffer[] = [];
      while (remainingBytes > 0 && state.audioBuffer.length > 0) {
        const buf = state.audioBuffer[0];
        if (buf.length <= remainingBytes) {
          chunkBuffers.push(buf);
          remainingBytes -= buf.length;
          state.audioBuffer.shift();
        } else {
          chunkBuffers.push(buf.subarray(0, remainingBytes));
          state.audioBuffer[0] = buf.subarray(remainingBytes);
          remainingBytes = 0;
        }
      }

      const audioForSTT = this.convertToFloat32(Buffer.concat(chunkBuffers));

      let peak = 0;
      for (let i = 0; i < audioForSTT.length; i++) {
        const abs = Math.abs(audioForSTT[i]);
        if (abs > peak) peak = abs;
      }

      if (peak < 0.001 || !this.config.stt.isReady()) {
        state.isProcessing = false;
        if (state.audioBuffer.length > 0) {
          setTimeout(() => this.processAudioBuffer(state, sampleRate), 0);
        }
        return;
      }

      const transResult = await this.config.stt.transcribe(audioForSTT, sampleRate);
      const text = transResult.text?.trim();
      if (!text) return;

      this.broadcast({ type: 'transcription', text });

      const translated = await this.config.translator.translate(text);
      if (translated && translated !== text) {
        this.broadcast({
          type: 'translation',
          text: translated,
          sourceLanguage: state.config.sourceLanguage,
          targetLanguage: state.config.targetLanguage,
        });
      }
    } catch (err) {
      logger.error('Audio processing error:', err);
    } finally {
      state.isProcessing = false;
      if (state.audioBuffer.length > 0) {
        setTimeout(() => this.processAudioBuffer(state, sampleRate), 0);
      }
    }
  }

  private convertToFloat32(pcmBuffer: Buffer): Float32Array {
    const samples = pcmBuffer.length / 2;
    const float32 = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      float32[i] = pcmBuffer.readInt16LE(i * 2) / 32768.0;
    }
    return float32;
  }

  private sendTo(ws: WebSocket, message: object): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
}
