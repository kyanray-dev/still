import { readdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const compressible = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt', '.xml']);
let count = 0;
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'downloads') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await visit(path);
    else if (compressible.has(extname(entry.name))) {
      const bytes = await readFile(path);
      if (bytes.length < 512) continue;
      const compressed = gzipSync(bytes, { level: 9 });
      if (compressed.length >= bytes.length) continue;
      await writeFile(`${path}.gz`, compressed);
      count += 1;
    }
  }
}
await visit(dist);
console.log(`Prepared ${count} static gzip files; installer bytes remain unchanged.`);
