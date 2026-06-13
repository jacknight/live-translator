// =============================================================================
// Live Translator Companion – Tray Icon
// =============================================================================

import { nativeImage, NativeImage } from 'electron';
import { join } from 'path';
import { existsSync } from 'fs';

export function createTrayIcon(): NativeImage {
  // Use the bundled app icon — Electron scales it for the tray automatically
  const candidates = [
    join(__dirname, '../../assets/icon.png'),
    join(__dirname, '../../assets/icon.ico'),
    join(process.resourcesPath || '', 'app', 'assets', 'icon.png'),
    join(process.resourcesPath || '', 'app', 'assets', 'icon.ico'),
  ];

  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        const img = nativeImage.createFromPath(p);
        if (!img.isEmpty()) {
          if (process.platform === 'darwin') {
            img.setTemplateImage(true);
          }
          return img;
        }
      }
    } catch {}
  }

  return nativeImage.createEmpty();
}
