import { copyFile, cp, mkdir, readFile, readdir, writeFile, chmod, stat } from 'node:fs/promises';
import { resolve, join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const config = JSON.parse(await readFile(join(root, 'neutralino.config.json'), 'utf8'));
const version = config.version;
const source = join(root, 'dist-native', config.cli.binaryName);
const output = resolve(root, 'release');
await mkdir(output, { recursive: true });
const winDir = join(output, `Still-${version}-Windows-x64`);
const macDir = join(output, `Still-${version}-macOS-universal`);
const appDir = join(macDir, '留白.app', 'Contents');
await mkdir(winDir, { recursive: true });
await mkdir(join(appDir, 'MacOS'), { recursive: true });
await mkdir(join(appDir, 'Resources'), { recursive: true });
await copyFile(join(source, 'liubai-win_x64.exe'), join(winDir, 'Still.exe'));
await copyFile(join(source, 'resources.neu'), join(winDir, 'resources.neu'));
await copyFile(join(source, 'liubai-mac_universal'), join(appDir, 'MacOS', 'liubai'));
await copyFile(join(source, 'resources.neu'), join(appDir, 'MacOS', 'resources.neu'));
await copyFile(join(root, 'public', 'app-icon.icns'), join(appDir, 'Resources', 'app-icon.icns'));
await chmod(join(appDir, 'MacOS', 'liubai'), 0o755);
await writeFile(join(appDir, 'PkgInfo'), 'APPL????');
await writeFile(join(appDir, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>留白</string>
  <key>CFBundleDisplayName</key><string>留白</string>
  <key>CFBundleIdentifier</key><string>${config.applicationId}</string>
  <key>CFBundleExecutable</key><string>liubai</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>app-icon.icns</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
`);
const sharedNotes = `Still · 留白 ${version}\n\n打开 .md / .markdown / .mdown / .mkd / .txt，或将文件拖入窗口。\nCtrl+O / ⌘O 打开；Ctrl+N / ⌘N 新建；Ctrl+E / ⌘E 编辑或阅读。\n点击编辑即可直接在排版后的正文中书写；也可切换到源码编辑。\n加粗、标题、列表等格式直接显示，保存仍为 Markdown 文件。\nCtrl+S / ⌘S 保存；Ctrl+Shift+S / ⌘Shift+S 另存为 Markdown。\nCtrl+F / ⌘F 搜索；Ctrl+P / ⌘P 打印或另存为 PDF。\n文档在本机处理，应用不上传文档；在线图片需要网络。\n阅读时不改变原文；点击编辑后可修改和保存。\n关闭窗口时询问未保存的修改；磁盘内容有外部修改时会提示冲突。\n使用系统退出或强制结束应用前，请先保存修改。\n可打开 UTF-8、带 BOM 的 UTF-16；编辑保存统一为 UTF-8，编辑器使用 LF 换行。\n单个文档和图片上限 10 MB。\n本地图片限文档所在目录及其子目录中的 PNG、JPEG、GIF、WebP、BMP。\n\n`;
await writeFile(join(winDir, '使用说明.txt'), sharedNotes + 'Windows 10 / 11 x64：完整解压后双击 Still.exe；请将同目录的 resources.neu 保留在一起。\n系统需要 Microsoft Edge WebView2 Runtime。Windows 11 一般已包含此组件。\n此开发版本没有代码签名；仅在确认来源可信后运行。\n');
await writeFile(join(macDir, '使用说明.txt'), sharedNotes + 'macOS 13+，Safari / 系统 WebKit 16.4 或更新，支持 Apple Silicon 与 Intel。\n解压后将「留白.app」拖入「应用程序」，再打开。\n此开发版本未经过 Apple 公证；若系统阻止打开，可在确认来源后通过「系统设置 → 隐私与安全性」允许本次打开。\n此包由跨平台构建生成，尚未在 Mac 实机运行验证。\n');
for (const directory of [winDir, macDir]) {
  await copyFile(join(root, 'LICENSE'), join(directory, 'LICENSE'));
  await copyFile(join(root, 'THIRD-PARTY-NOTICES.txt'), join(directory, 'THIRD-PARTY-NOTICES.txt'));
  await cp(join(root, 'licenses'), join(directory, 'licenses'), { recursive: true });
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
async function filesUnder(directory) {
  const all = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) all.push(...await filesUnder(path));
    else if (entry.isFile()) all.push(path);
  }
  return all.sort();
}
async function zip(directory) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const path of await filesUnder(directory)) {
    const name = Buffer.from(relative(dirname(directory), path).replaceAll('\\', '/'));
    const content = await readFile(path);
    const compressed = deflateRawSync(content, { level: 9 });
    const crc = crc32(content);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(33, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(content.length, 22);
    header.writeUInt16LE(name.length, 26);
    chunks.push(header, name, compressed);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(0x031e, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x800, 8);
    record.writeUInt16LE(8, 10);
    record.writeUInt16LE(33, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(compressed.length, 20);
    record.writeUInt32LE(content.length, 24);
    record.writeUInt16LE(name.length, 28);
    const isExecutable = path === join(appDir, 'MacOS', 'liubai');
    record.writeUInt32LE(((isExecutable ? 0o100755 : 0o100644) << 16) >>> 0, 38);
    record.writeUInt32LE(offset, 42);
    central.push(record, name);
    offset += header.length + name.length + compressed.length;
  }
  const directoryBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(directoryBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  const archive = Buffer.concat([...chunks, directoryBuffer, end]);
  const zipPath = `${directory}.zip`;
  await writeFile(zipPath, archive);
  return { name: relative(output, zipPath), bytes: (await stat(zipPath)).size, sha256: createHash('sha256').update(archive).digest('hex') };
}
const packages = [await zip(winDir), await zip(macDir)];
await writeFile(join(output, 'SHA256SUMS.txt'), packages.map(p => `${p.sha256}  ${p.name}`).join('\n') + '\n');
console.log(JSON.stringify(packages, null, 2));
