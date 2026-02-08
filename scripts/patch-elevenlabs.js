/**
 * Patches @elevenlabs/client SDK to fix a crash in handleErrorEvent
 * where e.error_event is undefined, causing:
 *   TypeError: Cannot read properties of undefined (reading 'error_type')
 *
 * Run automatically via npm postinstall.
 */
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'node_modules', '@elevenlabs', 'client', 'dist');

const patches = [
  {
    file: 'lib.module.js',
    find: 'handleErrorEvent=function(e){var t=e.error_event.error_type',
    replace: 'handleErrorEvent=function(e){if(!e||!e.error_event){console.warn("[ElevenLabs] Received malformed error event",e);return}var t=e.error_event.error_type',
  },
  {
    file: 'lib.cjs',
    find: 'handleErrorEvent=function(e){var t=e.error_event.error_type',
    replace: 'handleErrorEvent=function(e){if(!e||!e.error_event){console.warn("[ElevenLabs] Received malformed error event",e);return}var t=e.error_event.error_type',
  },
  {
    file: 'lib.umd.js',
    find: 'handleErrorEvent=function(e){var t=e.error_event.error_type',
    replace: 'handleErrorEvent=function(e){if(!e||!e.error_event){console.warn("[ElevenLabs] Received malformed error event",e);return}var t=e.error_event.error_type',
  },
  {
    file: 'lib.modern.js',
    find: 'handleErrorEvent(e){const t=e.error_event.error_type',
    replace: 'handleErrorEvent(e){if(!e||!e.error_event){console.warn("[ElevenLabs] Received malformed error event",e);return}const t=e.error_event.error_type',
  },
];

let patchedCount = 0;
for (const patch of patches) {
  const filePath = path.join(distDir, patch.file);
  if (!fs.existsSync(filePath)) continue;

  let src = fs.readFileSync(filePath, 'utf8');
  if (src.includes(patch.find)) {
    src = src.replace(patch.find, patch.replace);
    fs.writeFileSync(filePath, src);
    patchedCount++;
  }
}

if (patchedCount > 0) {
  console.log(`[patch-elevenlabs] Patched ${patchedCount} file(s) in @elevenlabs/client`);
}
