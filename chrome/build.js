#!/usr/bin/env node
/* Builds the Chrome / Edge package from the shared sources in firefox-sap-compagnon/.
   Usage: node chrome/build.js [--dir <folder>]
   - writes installer-chrome/compagnon-sap-fiori-chrome.zip (manifest at the root: ready for "Load unpacked"
     once extracted, or for the Chrome Web Store);
   - with --dir, also writes the unpacked extension to <folder>.
   No dependency: Node.js 18+ only (zip written with the built-in zlib). */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'firefox-sap-compagnon');
const LOGO = path.join(ROOT, 'installer-firefox', 'logo');
const OUT = path.join(ROOT, 'installer-chrome', 'compagnon-sap-fiori-chrome.zip');

// Shared sources (the Firefox manifest and the SVG icons are replaced by the Chrome ones)
const files = fs.readdirSync(SRC).filter(f => /\.(js|html|css)$/.test(f)).sort()
  .map(f => ({ name: f, data: fs.readFileSync(path.join(SRC, f)) }));
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
const firefoxVersion = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8')).version;
if (manifest.version !== firefoxVersion) {
  console.error(`Version mismatch: chrome/manifest.json ${manifest.version} vs firefox-sap-compagnon/manifest.json ${firefoxVersion}`);
  process.exit(1);
}
files.push({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n') });
for (const [size, png] of [[16, 'compagnon-sap-fiori-16.png'], [32, 'compagnon-sap-fiori-32.png'], [48, 'compagnon-sap-fiori-48.png'], [128, 'compagnon-sap-fiori-elyass-128.png']]) {
  files.push({ name: `icons/icon-${size}.png`, data: fs.readFileSync(path.join(LOGO, png)) });
}
// Every file referenced by the manifest must exist
const names = new Set(files.map(f => f.name));
const referenced = [manifest.background.service_worker, manifest.action.default_popup, manifest.options_ui.page, manifest.side_panel.default_path,
  ...manifest.content_scripts.flatMap(c => c.js), ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)];
const missing = referenced.filter(f => !names.has(f));
if (missing.length) { console.error('Missing files: ' + missing.join(', ')); process.exit(1); }

/* Minimal zip writer (deflate), fixed date so that the same sources give the same archive */
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const DOS_TIME = 0, DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01 00:00
function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const comp = zlib.deflateRawSync(e.data, { level: 9 });
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(e.data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    locals.push(local, name, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10); central.writeUInt16LE(DOS_TIME, 12); central.writeUInt16LE(DOS_DATE, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(e.data.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + comp.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, zip(files));
console.log(`Chrome package ${manifest.version}: ${path.relative(ROOT, OUT)} (${files.length} files)`);

const i = process.argv.indexOf('--dir');
if (i > 0 && process.argv[i + 1]) {
  const dir = path.resolve(process.argv[i + 1]);
  for (const f of files) { fs.mkdirSync(path.dirname(path.join(dir, f.name)), { recursive: true }); fs.writeFileSync(path.join(dir, f.name), f.data); }
  console.log('Unpacked extension: ' + dir);
}
