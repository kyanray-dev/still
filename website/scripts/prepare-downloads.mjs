#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const websiteDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDirectory = join(websiteDirectory, 'public');
const downloadsDirectory = join(publicDirectory, 'downloads');
const githubRelease = 'https://github.com/kyanray-dev/still/releases/download/v1.2.0/';

// Pin the bytes and hashes of the tested packages. Do not resolve /latest here:
// macOS 1.2.1 is distributed from the tested local build; Windows is 1.2.0.
const releases = [
  {
    platform: 'macos',
    kind: 'dmg',
    version: '1.2.1',
    name: 'Still-1.2.1-macOS-universal.dmg',
    bytes: 3004539,
    sha256: '3fe3f86f5c366fd43aaba0e27d599eec756fa1ffa5e1fe5fed9323f7b6e8719c',
    requirements: 'macOS 14+ · Apple Silicon / Intel',
  },
  {
    platform: 'macos',
    kind: 'zip',
    version: '1.2.1',
    name: 'Still-1.2.1-macOS-universal.zip',
    bytes: 2769447,
    sha256: '980ab5bd7caf193cdaeb816c2b6ad354b70a803eb7ccbc117506c2d1a4c756fe',
    requirements: 'macOS 14+ · Apple Silicon / Intel',
  },
  {
    platform: 'windows',
    kind: 'installer',
    version: '1.2.0',
    name: 'Still-1.2.0-Windows-x64-Setup.exe',
    bytes: 5289619,
    sha256: '5cbc0ee3a568141c57c02607edcd14f3ad154fb1fc047ca05ed51605849b927f',
    requirements: 'Windows 10 / 11 · x64',
  },
  {
    platform: 'windows',
    kind: 'zip',
    version: '1.2.0',
    name: 'Still-1.2.0-Windows-x64.zip',
    bytes: 2008740,
    sha256: 'ecf30648b5668f22e6740a698e9ad8b8990bc222d2dc7cfd56ce7f3b9cd69231',
    requirements: 'Windows 10 / 11 · x64 · WebView2 Runtime',
  },
].map((release) => ({ ...release, url: `/downloads/${release.name}` }));

function parseArguments(argumentsList) {
  const options = {
    verify: false,
    macosSource: process.env.STILL_RELEASE_DIR || join(websiteDirectory, '..', 'release'),
    help: false,
  };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--verify') options.verify = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--macos-source') {
      const source = argumentsList[++index];
      if (!source || source.startsWith('--')) throw new Error('--macos-source requires a directory.');
      options.macosSource = resolve(source);
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  options.macosSource = resolve(options.macosSource);
  return options;
}

async function inspectPackage(path, release) {
  let details;
  try {
    details = await stat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return { valid: false, reason: 'file is missing' };
    throw error;
  }
  if (!details.isFile()) return { valid: false, reason: 'path is not a file' };
  if (details.size !== release.bytes) {
    return { valid: false, reason: `expected ${release.bytes} bytes, found ${details.size}` };
  }
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  const digest = hash.digest('hex');
  return digest === release.sha256
    ? { valid: true }
    : { valid: false, reason: `SHA-256 mismatch: expected ${release.sha256}, found ${digest}` };
}

async function storeVerifiedPackage(stream, release, destination) {
  const temporaryPath = `${destination}.${process.pid}.part`;
  const hash = createHash('sha256');
  let bytes = 0;
  const verifier = new Transform({
    transform(chunk, encoding, callback) {
      bytes += chunk.length;
      if (bytes > release.bytes) {
        callback(new Error(`${release.name}: download exceeds the expected ${release.bytes} bytes.`));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(stream, verifier, createWriteStream(temporaryPath, { flags: 'wx', mode: 0o644 }));
    const digest = hash.digest('hex');
    if (bytes !== release.bytes || digest !== release.sha256) {
      throw new Error(
        `${release.name}: verification failed; received ${bytes} bytes, SHA-256 ${digest}.`,
      );
    }
    await rename(temporaryPath, destination);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function preparePackage(release, options) {
  const destination = join(downloadsDirectory, release.name);
  const existing = await inspectPackage(destination, release);
  if (existing.valid) {
    console.log(`Verified ${release.name} (${release.bytes} bytes).`);
    return;
  }
  if (options.verify) throw new Error(`${release.name}: ${existing.reason}.`);

  if (release.platform === 'macos') {
    const source = join(options.macosSource, release.name);
    const inspection = await inspectPackage(source, release);
    if (!inspection.valid) {
      throw new Error(`${source}: ${inspection.reason}. Set --macos-source or STILL_RELEASE_DIR to the tested release directory.`);
    }
    await storeVerifiedPackage(createReadStream(source), release, destination);
    console.log(`Copied and verified ${release.name} (${release.bytes} bytes).`);
    return;
  }

  console.log(`Downloading ${release.name} from the official GitHub release…`);
  const response = await fetch(`${githubRelease}${release.name}`, {
    redirect: 'follow',
    signal: AbortSignal.timeout(120000),
    headers: { 'User-Agent': 'Still-website-download-preparation' },
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`${release.name}: GitHub returned HTTP ${response.status}.`);
  }
  await storeVerifiedPackage(Readable.fromWeb(response.body), release, destination);
  console.log(`Downloaded and verified ${release.name} (${release.bytes} bytes).`);
}

async function writeAtomic(path, contents) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, contents, { flag: 'wx', mode: 0o644 });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function checkOrWrite(path, contents, verify) {
  if (verify) {
    let actual;
    try {
      actual = await readFile(path, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error(`${path} is missing. Run prepare:downloads first.`);
      throw error;
    }
    if (actual !== contents) throw new Error(`${path} does not match the pinned release manifest.`);
  } else await writeAtomic(path, contents);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node scripts/prepare-downloads.mjs [--macos-source <directory>] [--verify]');
    console.log('macOS source: --macos-source, then STILL_RELEASE_DIR, then website/../release.');
    console.log('--verify only reads the four packages and both manifests; it never downloads or writes.');
    return;
  }
  if (!options.verify) {
    await mkdir(downloadsDirectory, { recursive: true });
    await writeFile(join(downloadsDirectory, '.gitkeep'), '');
  }
  for (const release of releases) await preparePackage(release, options);
  await checkOrWrite(
    join(publicDirectory, 'downloads.json'),
    `${JSON.stringify({ releases }, null, 2)}\n`,
    options.verify,
  );
  await checkOrWrite(
    join(downloadsDirectory, 'SHA256SUMS.txt'),
    releases.map((release) => `${release.sha256}  ${release.name}\n`).join(''),
    options.verify,
  );
  console.log(`All four packages and both manifests ${options.verify ? 'verified' : 'ready'}.`);
}

main().catch((error) => {
  console.error(`Download preparation failed: ${error.message}`);
  process.exitCode = 1;
});
