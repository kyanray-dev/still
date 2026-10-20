import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

if (process.platform !== 'darwin') {
  console.log('The patched macOS runtime is only built on macOS.');
  process.exit(0);
}
if (!['arm64', 'x64'].includes(process.arch)) throw new Error(`Unsupported macOS build architecture: ${process.arch}`);

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const cache = join(root, '.build-cache', 'neutralino-macos');
const source = join(cache, 'source');
const build = join(cache, 'cmake-build');
const marker = join(cache, 'runtime.json');
const patches = ['neutralino-null-protocol.patch', 'neutralino-cocoa-points.patch', 'neutralino-intel-rect-abi.patch'].map(name => join(root, 'installer', 'macos', name));
const repository = 'https://github.com/neutralinojs/neutralinojs.git';
const commit = '4361b63eb1157fc7dedb29b92815a08ec0002767';
const minimumSystemVersion = '14.0';
const cmake = process.env.CMAKE || 'cmake';
const jobs = process.env.BUILD_JOBS || '4';
if (!/^[1-9]\d*$/.test(jobs)) throw new Error('BUILD_JOBS must be a positive integer.');

const binaries = {
  universal: 'neutralino-mac_universal',
  arm64: 'neutralino-mac_arm64',
  x64: 'neutralino-mac_x64',
};
const sha256 = data => createHash('sha256').update(data).digest('hex');
const patchSHA256 = sha256(Buffer.concat(await Promise.all(patches.map(path => readFile(path)))));

// Check the installed files as well as the marker. `neu update` can replace any
// runtime without removing our marker, so the marker alone is never a cache hit.
async function cacheIsCurrent() {
  try {
    const saved = JSON.parse(await readFile(marker, 'utf8'));
    if (saved.schemaVersion !== 1 || saved.commit !== commit || saved.patchSHA256 !== patchSHA256 ||
        saved.minimumSystemVersion !== minimumSystemVersion) return false;
    for (const [architecture, name] of Object.entries(binaries)) {
      if (sha256(await readFile(join(root, 'bin', name))) !== saved.binarySHA256?.[architecture]) return false;
    }
    return true;
  } catch {
    return false;
  }
}

if (await cacheIsCurrent()) {
  console.log(`Using verified patched macOS runtime (${commit.slice(0, 12)}).`);
  process.exit(0);
}

async function execute(command, args) {
  console.log(`> ${command} ${args.join(' ')}`);
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed (${signal || `exit ${code}`}).`));
    });
  });
}

await mkdir(cache, { recursive: true });
try {
  await access(join(source, '.git'));
} catch {
  await execute('git', ['init', source]);
  await execute('git', ['-C', source, 'remote', 'add', 'origin', repository]);
}
const { stdout: origin } = await run('git', ['-C', source, 'remote', 'get-url', 'origin']);
if (origin.trim() !== repository) throw new Error(`Unexpected Neutralino cache remote: ${origin.trim()}`);
try {
  await run('git', ['-C', source, 'cat-file', '-e', `${commit}^{commit}`]);
} catch {
  await execute('git', ['-C', source, 'fetch', '--depth', '1', 'origin', commit]);
}
await execute('git', ['-C', source, 'checkout', '--detach', commit]);
const { stdout: head } = await run('git', ['-C', source, 'rev-parse', 'HEAD']);
if (head.trim() !== commit) throw new Error('The Neutralino source does not match the pinned commit.');
for (const patch of patches) {
  try {
    await run('git', ['-C', source, 'apply', '--reverse', '--check', patch]);
    console.log('The macOS protocol patch is already applied.');
  } catch {
    await execute('git', ['-C', source, 'apply', '--check', patch]);
    await execute('git', ['-C', source, 'apply', patch]);
  }
}

await execute(cmake, ['-S', source, '-B', build, '-DCMAKE_BUILD_TYPE=Release',
  '-DCMAKE_OSX_ARCHITECTURES=arm64;x86_64', `-DCMAKE_OSX_DEPLOYMENT_TARGET=${minimumSystemVersion}`]);
await execute(cmake, ['--build', build, '--config', 'Release', '--parallel', jobs]);

// Neutralino names the universal build after the build host. Validate it before
// replacing the runtime files consumed by `neu build`.
const compiled = join(source, 'bin', binaries[process.arch]);
const { stdout: architectures } = await run('/usr/bin/lipo', ['-archs', compiled]);
if (architectures.trim().split(/\s+/).sort().join(' ') !== 'arm64 x86_64') {
  throw new Error(`Expected an arm64 + x86_64 universal runtime, got: ${architectures.trim()}`);
}
await run('/usr/bin/lipo', [compiled, '-verify_arch', 'arm64', 'x86_64']);
const temporary = await mkdtemp(join(cache, 'runtime-'));
try {
  await copyFile(compiled, join(temporary, binaries.universal));
  for (const [architecture, slice] of [['arm64', 'arm64'], ['x64', 'x86_64']]) {
    await run('/usr/bin/lipo', [compiled, '-thin', slice, '-output', join(temporary, binaries[architecture])]);
    await run('/usr/bin/lipo', [join(temporary, binaries[architecture]), '-verify_arch', slice]);
  }
  const binarySHA256 = {};
  for (const [architecture, name] of Object.entries(binaries)) {
    await chmod(join(temporary, name), 0o755);
    binarySHA256[architecture] = sha256(await readFile(join(temporary, name)));
  }
  await mkdir(join(root, 'bin'), { recursive: true });
  for (const name of Object.values(binaries)) await rename(join(temporary, name), join(root, 'bin', name));
  await writeFile(join(temporary, 'runtime.json'), JSON.stringify({
    schemaVersion: 1, repository, commit, patchSHA256, minimumSystemVersion, binarySHA256,
  }, null, 2) + '\n');
  await rename(join(temporary, 'runtime.json'), marker);
  console.log(JSON.stringify({ commit, patchSHA256, binarySHA256 }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
