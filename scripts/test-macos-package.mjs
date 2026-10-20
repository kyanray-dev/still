import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

if (process.platform !== 'darwin') throw new Error('The macOS package verification requires macOS.');

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const config = JSON.parse(await readFile(join(root, 'neutralino.config.json'), 'utf8'));
const output = join(root, 'release');
const packageName = `Still-${config.version}-macOS-universal`;
const packageDirectory = join(output, packageName);
const builtApp = join(packageDirectory, '留白.app');
const resultsDirectory = join(root, 'test-results', 'macos-package');
await mkdir(resultsDirectory, { recursive: true });
const temporary = await mkdtemp(join(resultsDirectory, 'verify-'));
const mountpoint = join(temporary, 'mount');
const checks = [];
let mounted = false;
let report;

async function appSignature(app) {
  const contents = join(app, 'Contents');
  const executable = join(contents, 'MacOS', 'liubai');
  await run('/usr/bin/plutil', ['-lint', join(contents, 'Info.plist')]);
  const { stdout: plistJson } = await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(contents, 'Info.plist')]);
  const plist = JSON.parse(plistJson);
  assert.equal(plist.CFBundleIdentifier, config.applicationId);
  assert.equal(plist.CFBundleShortVersionString, config.version);
  assert.equal(plist.LSMinimumSystemVersion, '14.0');
  const markdownExtensions = ['md', 'markdown', 'mdown', 'mkd'].sort();
  const markdownType = 'net.daringfireball.markdown';
  const markdownDocument = plist.CFBundleDocumentTypes?.find(type => type.LSItemContentTypes?.includes(markdownType));
  assert.ok(markdownDocument, 'The app must advertise Markdown documents to Launch Services.');
  assert.equal(markdownDocument.CFBundleTypeRole, 'Editor');
  assert.equal(markdownDocument.LSHandlerRank, 'Alternate');
  assert.deepEqual(markdownDocument.CFBundleTypeExtensions?.toSorted(), markdownExtensions);
  const importedMarkdown = plist.UTImportedTypeDeclarations?.find(type => type.UTTypeIdentifier === markdownType);
  assert.ok(importedMarkdown, 'The Markdown UTI must be imported so extensions resolve without another Markdown app.');
  assert.ok(importedMarkdown.UTTypeConformsTo?.includes('public.plain-text'));
  assert.deepEqual(importedMarkdown.UTTypeTagSpecification?.['public.filename-extension']?.toSorted(), markdownExtensions);
  assert.equal(importedMarkdown.UTTypeTagSpecification?.['public.mime-type'], 'text/markdown');
  const plainTextDocument = plist.CFBundleDocumentTypes?.find(type => type.LSItemContentTypes?.includes('public.plain-text'));
  assert.ok(plainTextDocument, 'The app must advertise its plain-text document support.');
  assert.equal(plainTextDocument.CFBundleTypeRole, 'Editor');
  assert.equal(plainTextDocument.LSHandlerRank, 'Alternate', 'Plain-text support must not claim ownership of the system text type.');
  assert.deepEqual(plainTextDocument.CFBundleTypeExtensions, ['txt']);
  const { stdout: architectures } = await run('/usr/bin/lipo', ['-archs', executable]);
  assert.equal(architectures.trim().split(/\s+/).sort().join(' '), 'arm64 x86_64');
  const { stdout: commands } = await run('/usr/bin/otool', ['-arch', 'all', '-l', executable]);
  assert.deepEqual([...commands.matchAll(/\bminos\s+([\d.]+)/g)].map(match => match[1]), ['14.0', '14.0']);
  assert.ok((await lstat(executable)).mode & 0o111, 'The main binary must be executable.');
  assert.equal(await readlink(join(contents, 'MacOS', 'resources.neu')), '../Resources/resources.neu');
  for (const path of ['resources.neu', 'LICENSE', 'THIRD-PARTY-NOTICES.txt', 'licenses/neutralinojs-native-LICENSE.txt']) {
    await access(join(contents, 'Resources', path));
  }
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--all-architectures', '--verbose=2', app]);
  const { stderr: signature } = await run('/usr/bin/codesign', ['--display', '--verbose=4', app]);
  assert.ok(signature.includes(`Identifier=${config.applicationId}\n`));
  assert.match(signature, /Info.plist entries=/, 'Info.plist must be bound by the bundle signature.');
  assert.match(signature, /Sealed Resources version=2/, 'The bundle resources must be sealed.');
  const cdhash = signature.match(/^CDHash=(\w+)$/m)?.[1];
  assert.ok(cdhash, 'The signed app must have a CDHash.');
  return { cdhash, executableSha256: createHash('sha256').update(await readFile(executable)).digest('hex') };
}

try {
  const signature = await appSignature(builtApp);
  checks.push('The app has both native architectures, executable permissions, macOS 14.0 deployment targets, and matching bundle metadata.');
  checks.push('The app declares Markdown and plain-text Editor document roles, Markdown filename extensions and imported UTI tags, with alternate handler rank.');
  checks.push('The app identifier and Info.plist are bound to a strict-valid bundle signature with sealed resources and bundled licenses.');
  assert.equal(await readlink(join(packageDirectory, 'Applications')), '/Applications');
  const manifest = (await readFile(join(output, 'SHA256SUMS-macOS.txt'), 'utf8')).trim().split('\n');
  assert.equal(manifest.length, 2);
  for (const extension of ['dmg', 'zip']) {
    const name = `${packageName}.${extension}`;
    const digest = createHash('sha256').update(await readFile(join(output, name))).digest('hex');
    assert.ok(manifest.includes(`${digest}  ${name}`), `Checksum mismatch for ${name}`);
  }
  checks.push('The macOS checksum manifest covers exactly the DMG and ZIP artifacts.');

  const zipDirectory = join(temporary, 'zip');
  await mkdir(zipDirectory);
  await run('/usr/bin/ditto', ['-x', '-k', join(output, `${packageName}.zip`), zipDirectory]);
  assert.deepEqual(await appSignature(join(zipDirectory, packageName, '留白.app')), signature);
  checks.push('Native ZIP extraction preserves the signed binary, sealed resources, and resource symlink.');

  await run('/usr/bin/hdiutil', ['verify', join(output, `${packageName}.dmg`)], { timeout: 60000 });
  await mkdir(mountpoint);
  await run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mountpoint, join(output, `${packageName}.dmg`)], { timeout: 60000 });
  mounted = true;
  const { stdout: diskInfo } = await run('/usr/sbin/diskutil', ['info', '-plist', mountpoint]);
  // hdiutil's -readonly attachment is checked against its mounted disk record.
  assert.match(diskInfo, /<key>WritableVolume<\/key>\s*<false\s*\/>/, 'The DMG must be mounted read-only.');
  assert.equal(await readlink(join(mountpoint, 'Applications')), '/Applications');
  assert.deepEqual(await appSignature(join(mountpoint, '留白.app')), signature);
  const installed = join(temporary, 'Applications', '留白.app');
  await mkdir(join(temporary, 'Applications'));
  await run('/usr/bin/ditto', [join(mountpoint, '留白.app'), installed]);
  assert.deepEqual(await appSignature(installed), signature);
  checks.push('The DMG verifies, mounts read-only, includes an Applications link, and retains the same signature after installation by copying.');
  await run('/usr/bin/hdiutil', ['detach', mountpoint], { timeout: 60000 });
  mounted = false;
  checks.push('The mounted DMG detaches successfully.');

  // A valid signature must also detect changes to the application's resources.
  const tampered = join(temporary, 'tampered.app');
  await run('/usr/bin/ditto', [builtApp, tampered]);
  await writeFile(join(tampered, 'Contents', 'Resources', 'LICENSE'), 'tampered test fixture');
  await assert.rejects(run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--all-architectures', tampered]));
  checks.push('Changing a sealed resource makes signature verification fail.');
  report = { passed: true, version: config.version, ...signature, checks, nativeApplicationLaunched: false, gatekeeperTrustVerified: false, notarizationVerified: false };
} catch (error) {
  report = { passed: false, version: config.version, checks, error: error.message };
  throw error;
} finally {
  if (mounted) await run('/usr/bin/hdiutil', ['detach', mountpoint], { timeout: 60000 });
  await rm(temporary, { recursive: true, force: true });
  if (report) {
    await writeFile(join(resultsDirectory, 'results.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  }
}
