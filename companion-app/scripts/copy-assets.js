#!/usr/bin/env node
/**
 * copy-assets.js – Copies non-TypeScript assets from src/ to dist/
 *
 * tsc only compiles .ts files. This script copies everything else needed
 * at runtime: HTML, CSS, icons, etc. preserving the directory structure.
 */

const { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } = require('fs');
const { resolve, relative, extname, dirname } = require('path');

const SRC = resolve(__dirname, '..', 'src');
const DST = resolve(__dirname, '..', 'dist');

// File extensions to copy (tsc handles .ts, we handle everything else)
const ASSET_EXTS = new Set(['.html', '.css', '.js', '.json', '.svg', '.png', '.ico', '.woff2']);

let copied = 0;

function copyAssets(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = resolve(dir, entry.name);
    const relPath = relative(SRC, srcPath);
    const dstPath = resolve(DST, relPath);

    if (entry.isDirectory()) {
      copyAssets(srcPath);
    } else if (entry.isFile() && ASSET_EXTS.has(extname(entry.name).toLowerCase())) {
      const dstDir = dirname(dstPath);
      if (!existsSync(dstDir)) {
        mkdirSync(dstDir, { recursive: true });
      }
      copyFileSync(srcPath, dstPath);
      copied++;
    }
  }
}

if (!existsSync(SRC)) {
  console.error('  ✗ Source directory not found:', SRC);
  process.exit(1);
}

console.log('  Copying assets...');
copyAssets(SRC);
console.log(`  ✓ ${copied} asset(s) copied to ${DST}`);
