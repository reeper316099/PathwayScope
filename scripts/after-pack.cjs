// electron-builder "afterPack" hook: on macOS, ad-hoc sign the app so its signature is VALID (not Developer-ID signed, not notarized).
// Without this, electron-builder (identity: null) leaves a half-broken signature that Apple Silicon reports as "damaged".
const { execFileSync } = require('node:child_process');
const path = require('node:path');

// Runs after the app folder is assembled and before the .dmg is made.
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  // codesign refuses files carrying extended attributes such as com.apple.provenance ("detritus"), so clear them first.
  execFileSync('xattr', ['-cr', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  console.log(`  • ad-hoc signed and verified ${app}`);
};
