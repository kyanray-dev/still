import { chmod, copyFile, cp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';

if (process.platform !== 'darwin') throw new Error('macOS packaging requires macOS codesign, ditto, and hdiutil.');

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const config = JSON.parse(await readFile(join(root, 'neutralino.config.json'), 'utf8'));
const version = config.version;
const minimumSystemVersion = '14.0';
const output = join(root, 'release');
const packageDirectory = join(output, `Still-${version}-macOS-universal`);
const app = join(packageDirectory, '留白.app');
const contents = join(app, 'Contents');
const resources = join(contents, 'Resources');
const executable = join(contents, 'MacOS', 'liubai');
const source = join(root, 'dist-native', config.cli.binaryName);
const signingIdentity = process.env.STILL_MACOS_SIGN_IDENTITY || '-';
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');

await mkdir(output, { recursive: true });
await rm(packageDirectory, { recursive: true, force: true });
await mkdir(join(contents, 'MacOS'), { recursive: true });
await mkdir(resources, { recursive: true });
await copyFile(join(source, 'liubai-mac_universal'), executable);
await chmod(executable, 0o755);
await copyFile(join(source, 'resources.neu'), join(resources, 'resources.neu'));
// Neutralino resolves the resource archive beside its executable. Keep the actual
// data in Resources while retaining that relative lookup after app relocation.
await symlink('../Resources/resources.neu', join(contents, 'MacOS', 'resources.neu'));
await copyFile(join(root, 'public', 'app-icon.icns'), join(resources, 'app-icon.icns'));
for (const name of ['LICENSE', 'THIRD-PARTY-NOTICES.txt']) await copyFile(join(root, name), join(resources, name));
await cp(join(root, 'licenses'), join(resources, 'licenses'), { recursive: true });
await writeFile(join(contents, 'PkgInfo'), 'APPL????');
await writeFile(join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>留白</string>
  <key>CFBundleDisplayName</key><string>留白</string>
  <key>CFBundleIdentifier</key><string>${xml(config.applicationId)}</string>
  <key>CFBundleExecutable</key><string>liubai</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>app-icon.icns</string>
  <key>CFBundleShortVersionString</key><string>${xml(version)}</string>
  <key>CFBundleVersion</key><string>${xml(version)}</string>
  <key>LSMinimumSystemVersion</key><string>${minimumSystemVersion}</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
`);

const { stdout: architectures } = await run('/usr/bin/lipo', ['-archs', executable]);
if (architectures.trim().split(/\s+/).sort().join(' ') !== 'arm64 x86_64') {
  throw new Error(`Expected an arm64 + x86_64 universal runtime, got: ${architectures.trim()}`);
}
const { stdout: loadCommands } = await run('/usr/bin/otool', ['-arch', 'all', '-l', executable]);
const deploymentTargets = [...loadCommands.matchAll(/\bminos\s+([\d.]+)/g)].map(match => match[1]);
if (deploymentTargets.length !== 2 || deploymentTargets.some(target => target !== minimumSystemVersion)) {
  throw new Error(`Runtime deployment targets must match macOS ${minimumSystemVersion}: ${deploymentTargets.join(', ')}`);
}
await run('/usr/bin/plutil', ['-lint', join(contents, 'Info.plist')]);
const signingArguments = ['--force', '--sign', signingIdentity, '--identifier', config.applicationId];
if (signingIdentity !== '-') signingArguments.push('--options', 'runtime', '--timestamp');
await run('/usr/bin/codesign', [...signingArguments, app]);
await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--all-architectures', '--verbose=2', app]);

await symlink('/Applications', join(packageDirectory, 'Applications'));
await writeFile(join(packageDirectory, '安装说明.txt'), `Still · 留白 ${version}

系统要求：macOS 14 Sonoma 或更新版本，支持 Apple Silicon 与 Intel。
安装：打开 DMG，将「留白.app」拖到 Applications，然后从「应用程序」打开。
ZIP：完整解压后将「留白.app」拖入「应用程序」。
⌘O 打开文件，⌘N 新建，⌘S 保存，⌘⇧S 另存为，⌘P 打印或导出 PDF。
关闭或退出应用前请保存文档。

${signingIdentity === '-' ? '本包使用本机临时签名（ad-hoc），没有 Apple Developer ID 签名。' : '本包使用配置的代码签名身份签名。'}
本打包步骤不执行 Apple 公证，也不表示已通过 Gatekeeper 信任检查。
若系统阻止打开，请先核对下载来源及 SHA-256，再使用「系统设置 → 隐私与安全性」中系统提供的允许选项。
应用许可及第三方许可位于「留白.app/Contents/Resources」。
`);

const dmg = `${packageDirectory}.dmg`;
const zip = `${packageDirectory}.zip`;
await rm(zip, { force: true });
await run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', packageDirectory, zip]);
await run('/usr/bin/hdiutil', ['create', '-ov', '-volname', `留白 ${version}`, '-srcfolder', packageDirectory, '-format', 'UDZO', '-fs', 'HFS+', dmg], { timeout: 120000 });
const packages = [];
for (const path of [dmg, zip]) {
  packages.push({ name: basename(path), bytes: (await stat(path)).size, sha256: createHash('sha256').update(await readFile(path)).digest('hex') });
}
await writeFile(join(output, 'SHA256SUMS-macOS.txt'), packages.map(item => `${item.sha256}  ${item.name}`).join('\n') + '\n');
console.log(JSON.stringify({ platform: 'macOS universal', minimumSystemVersion, signing: signingIdentity === '-' ? 'ad-hoc' : 'configured identity', notarized: false, packages }, null, 2));
