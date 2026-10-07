import { readFile, writeFile, readdir, mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
const notices = ['Still — third-party notices', '', 'Original project code is licensed under 0BSD; the dependencies below are not relicensed.', 'The following runtime dependencies retain their respective licenses.', 'License texts are included in the licenses directory.', ''];
await mkdir(join(root, 'licenses'), { recursive: true });
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path || entry.dev) continue;
  try {
    const directory = join(root, path);
    const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    const name = `${pkg.name.replaceAll('/', '-').replaceAll('@', '')}-${pkg.version}`;
    const files = (await readdir(directory)).filter(file => /^(licen[cs]e|copying|notice)([.-]|$)/i.test(file));
    for (const file of files) await copyFile(join(directory, file), join(root, 'licenses', `${name}-${file}.txt`));
    notices.push(`${pkg.name} ${pkg.version} — ${typeof pkg.license === 'string' ? pkg.license : entry.license || 'See included license'}`);
  } catch { /* Optional dependencies may be absent on this platform. */ }
}
notices.push('', 'Neutralinojs native framework 6.10.0 — MIT', 'https://github.com/neutralinojs/neutralinojs', 'See licenses/neutralinojs-native-LICENSE.txt', '');
await writeFile(join(root, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n'));
