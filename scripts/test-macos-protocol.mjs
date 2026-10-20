import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

if (process.argv.length !== 2) throw new Error('This regression runner accepts no arguments and only runs the safe protocol probe.');
if (process.platform !== 'darwin') {
  console.log('The macOS protocol regression is only run on macOS.');
  process.exit(0);
}

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const source = join(root, 'scripts', 'test-macos-protocol.mm');
const resultsDirectory = join(root, 'test-results', 'macos-protocol');
await mkdir(resultsDirectory, { recursive: true });
const temporary = await mkdtemp(join(resultsDirectory, 'probe-'));
const executable = join(temporary, 'test-macos-protocol');
const sourceSHA256 = createHash('sha256').update(await readFile(source)).digest('hex');
let report;

try {
  await run('/usr/bin/clang++', ['-std=c++17', '-mmacosx-version-min=14.0', '-framework', 'AppKit', '-framework', 'WebKit', source, '-o', executable], { timeout: 120000 });
  // No arguments: the diagnostic --reproduce-unsafe mode must never run in CI.
  const { stdout, stderr } = await run(executable, [], { timeout: 30000 });
  assert.match(stderr, /PASS: 4,000,000 protocol conformance checks/);
  const rectSource = join(root, 'scripts', 'test-macos-rect.mm');
  const rectExecutable = join(temporary, 'test-macos-rect');
  await run('/usr/bin/clang++', ['-std=c++17', '-arch', 'arm64', '-arch', 'x86_64', '-mmacosx-version-min=14.0', '-framework', 'Foundation', '-framework', 'CoreGraphics', rectSource, '-o', rectExecutable], { timeout: 120000 });
  await run('/usr/bin/codesign', ['--force', '--sign', '-', rectExecutable]);
  const rect = await run(rectExecutable, [], { timeout: 30000 });
  assert.match(rect.stdout, /PASS: CGRect getter and CGRect argument\/return dispatch/);
  report = { passed: true, mode: 'safe', protocolConformanceChecks: 4000000, sourceSHA256, stdout, stderr, rectABI: { passed: true, universalCompiled: true, testedArchitecture: process.arch, output: rect.stdout } };
} catch (error) {
  report = { passed: false, mode: 'safe', sourceSHA256, error: error.message, stdout: error.stdout, stderr: error.stderr };
  throw error;
} finally {
  await rm(temporary, { recursive: true, force: true });
  if (report) {
    await writeFile(join(resultsDirectory, 'results.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  }
}
