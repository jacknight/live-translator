// =============================================================================
// Live Translator Companion – Server Entry Point
// =============================================================================
//
// WebSocket server that receives audio from the browser extension,
// runs speech-to-text via whisper.cpp, translates the text,
// and sends captions back to the extension.
// =============================================================================

import { WebSocketServer } from './websocket-server';
import { WhisperSTT } from './stt/whisper';
import { Translator } from './translator';
import { Logger } from './utils/logger';
import { getConfig } from './config';

const logger = new Logger('Server');

// --- Main -------------------------------------------------------------------
async function main() {
  const config = getConfig();

  logger.info('Starting Live Translator Companion...');
  logger.info(`WebSocket server will listen on port ${config.wsPort}`);
  logger.info(`whisper.cpp: ${config.whisperExecPath}`);
  logger.info(`Model: ${config.whisperModelPath}`);
  logger.info(`Translation: ${config.sourceLanguage} → ${config.targetLanguage}`);

  // Initialize STT engine
  const stt = new WhisperSTT({
    execPath: config.whisperExecPath,
    modelPath: config.whisperModelPath,
  });

  // Initialize translator
  const translator = new Translator({
    sourceLanguage: config.sourceLanguage,
    targetLanguage: config.targetLanguage,
  });

  // Initialize WebSocket server
  const wsServer = new WebSocketServer({
    wsHost: config.wsHost,
    port: config.wsPort,
    stt,
    translator,
  });

  try {
    await stt.initialize();
    logger.info('STT engine initialized');

    await translator.initialize();
    logger.info('Translator initialized');

    await wsServer.start();
    logger.info(`WebSocket server listening on ws://127.0.0.1:${config.wsPort}`);
    logger.info('Live Translator Companion is ready!');
  } catch (err) {
    logger.error('Failed to start:', err);
    process.exit(1);
  }

  // --- Graceful Shutdown ----------------------------------------------------
  const shutdown = async () => {
    logger.info('Shutting down...');
    wsServer.stop();
    stt.cleanup();
    translator.cleanup();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception:', err);
    shutdown();
  });
}

main().catch((err) => {
  logger.error('Fatal error:', err);
  process.exit(1);
});
