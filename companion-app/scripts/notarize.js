#!/usr/bin/env node
/**
 * afterPack script — ad-hoc signs the macOS app bundle.
 * This prevents the "damaged" error when running unsigned apps.
 * No Apple Developer account required.
 */

const { execSync } = require('child_process');
const { existsSync } = require('fs');

exports.default = async function (context) {
  if (process.platform !== 'darwin') return;

  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`;

  if (!existsSync(appPath)) {
    console.log('  App not found for signing:', appPath);
    return;
  }

  console.log('  Ad-hoc signing:', appPath);
  try {
    execSync(`codesign --force --deep -s - "${appPath}"`, { stdio: 'inherit' });
    console.log('  ✓ Ad-hoc signed');
  } catch (err) {
    console.log('  ⚠ Signing failed:', err.message);
  }
};
