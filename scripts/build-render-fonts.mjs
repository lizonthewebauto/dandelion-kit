// One-time helper: copy two static font instances into core/render/fonts with unique family names,
// because libass only finds a font by its family name and the variable fonts in assets/fonts do not load there.
// The outputs are committed, so the kit never needs to run this. Source files: static instances of the OFL
// Montserrat (ExtraBold) and Inter (SemiBold) cut from the variable fonts in assets/fonts.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Replace the name table so the font answers to one family name. */
export function renameFont(buf, family) {
  const numTables = buf.readUInt16BE(4);
  const names = [
    [1, family],
    [2, 'Regular'],
    [3, `${family};dandelion-kit`],
    [4, family],
    [6, family.replace(/\s+/g, '-')],
  ];
  const strings = names.map(([, text]) => Buffer.from(text, 'utf16le').swap16());
  const header = Buffer.alloc(6 + names.length * 12);
  header.writeUInt16BE(0, 0);
  header.writeUInt16BE(names.length, 2);
  header.writeUInt16BE(header.length, 4);
  let offset = 0;
  names.forEach(([id], i) => {
    const r = 6 + i * 12;
    header.writeUInt16BE(3, r);
    header.writeUInt16BE(1, r + 2);
    header.writeUInt16BE(0x409, r + 4);
    header.writeUInt16BE(id, r + 6);
    header.writeUInt16BE(strings[i].length, r + 8);
    header.writeUInt16BE(offset, r + 10);
    offset += strings[i].length;
  });
  let table = Buffer.concat([header, ...strings]);
  const padded = Buffer.concat([table, Buffer.alloc((4 - (table.length % 4)) % 4)]);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) >>> 0;
  const out = Buffer.concat([buf, Buffer.alloc((4 - (buf.length % 4)) % 4)]);
  const newOffset = out.length;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (buf.toString('latin1', rec, rec + 4) === 'name') {
      out.writeUInt32BE(sum, rec + 4);
      out.writeUInt32BE(newOffset, rec + 8);
      out.writeUInt32BE(table.length, rec + 12);
    }
  }
  return Buffer.concat([out, padded]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(join(ROOT, 'core/render/fonts'), { recursive: true });
  const jobs = [
    [
      'core/carousel/fonts/Montserrat-ExtraBold.ttf',
      'core/render/fonts/Montserrat-ExtraBold.ttf',
      'Montserrat ExtraBold',
    ],
    ['core/carousel/fonts/Inter-SemiBold.ttf', 'core/render/fonts/Inter-SemiBold.ttf', 'Inter SemiBold'],
  ];
  for (const [from, to, family] of jobs) {
    writeFileSync(join(ROOT, to), renameFont(readFileSync(join(ROOT, from)), family));
    console.log(`wrote ${to}`);
  }
}
