// Zips dist/ into brockstars-site.zip, for uploading through cPanel's File Manager (upload it, then
// Extract it into the site's folder) when SSH deploys aren't available. Plain Node, no dependencies.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { deflateRawSync, crc32 } from 'node:zlib';

const ROOT = 'dist', OUT = 'brockstars-site.zip';
const files = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? files(p) : [p];
});

const header = (signature, size) => {
  const b = Buffer.alloc(size);
  b.writeUInt32LE(signature, 0);
  return b;
};

const parts = [], central = [];
let offset = 0;
for (const path of files(ROOT)) {
  const name = Buffer.from(relative(ROOT, path).split('\\').join('/'));   // zip paths use forward slashes
  const data = readFileSync(path), packed = deflateRawSync(data), crc = crc32(data);
  const local = header(0x04034b50, 30);
  local.writeUInt16LE(20, 4);                 // version needed
  local.writeUInt16LE(8, 8);                  // deflate
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const entry = header(0x02014b50, 46);
  entry.writeUInt16LE(20, 4);
  entry.writeUInt16LE(20, 6);
  entry.writeUInt16LE(8, 10);
  entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(packed.length, 20);
  entry.writeUInt32LE(data.length, 24);
  entry.writeUInt16LE(name.length, 28);
  entry.writeUInt32LE(offset, 42);
  parts.push(local, name, packed);
  central.push(Buffer.concat([entry, name]));
  offset += local.length + name.length + packed.length;
}
const directory = Buffer.concat(central), end = header(0x06054b50, 22);
end.writeUInt16LE(central.length, 8);
end.writeUInt16LE(central.length, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);
writeFileSync(OUT, Buffer.concat([...parts, directory, end]));
console.log(`${OUT}: ${central.length} files from ${ROOT}/`);
