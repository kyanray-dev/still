import { chromium, expect } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile, copyFile, readFile, unlink, readdir, chmod } from 'node:fs/promises';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';

if (process.platform !== 'win32') {
  console.log('Native WebView2 smoke test requires Windows; no other platform is marked passed.');
  process.exit(0);
}
const root = fileURLToPath(new URL('../', import.meta.url));
const work = join(root, 'test-results', 'native');
const buildConfig = JSON.parse(await readFile(join(root, 'neutralino.config.json'), 'utf8'));
const artifact = {
  version: buildConfig.version,
  resourcesSha256: createHash('sha256').update(await readFile(join(root, 'dist-native', 'liubai', 'resources.neu'))).digest('hex'),
  executableSha256: createHash('sha256').update(await readFile(join(root, 'dist-native', 'liubai', 'liubai-win_x64.exe'))).digest('hex'),
};
await mkdir(join(work, '图片'), { recursive: true });
const filename = join(work, '原生 测试.md');
const dropped = join(work, '拖入的文档.md');
const readonly = join(work, '只读文档.md');
const utf16 = join(work, 'UTF16文档.md');
const visualFile = join(work, '可视正文.md');
const visualOriginal = '# 可视原生编辑\n\n普通段落，保留原文。\n\n**原有加粗**\n\n- 第一项\n- 第二项\n\n| 名称 | 值 |\n| --- | --- |\n| 原生 | 正常 |\n';
const content = '# 原生中文阅读\n\n这是一份使用真实文件系统打开的文档。\n\n## 本地图片\n\n![阅读图](图片/阅读图.png)\n\n## 搜索与代码\n\n原生测试可以搜索与浏览。\n\n```ts\nconst quiet = true;\n```\n';
await writeFile(filename, '\uFEFF' + content);
await writeFile(dropped, '# 拖入的新文档\n\n来自原生事件与真实文件系统。');
await chmod(readonly, 0o644).catch(() => {});
await writeFile(readonly, '# 只读原文\n');
await chmod(readonly, 0o444);
await writeFile(utf16, Buffer.from('\uFEFF# UTF16原文\n', 'utf16le'));
await writeFile(visualFile, visualOriginal);
await copyFile(join(root, 'public', 'app-icon.png'), join(work, '图片', '阅读图.png'));
const errors = [];
const checks = [];
let child;
let browser;
let activePage;
let storageBackup;
let failed = false;
let activeLaunch;
const launches = [];
const startupTimeoutMs = process.env.CI ? 60000 : 20000;
const webviewData = process.env.CI ? join(tmpdir(), 'still-native-webview-data') : join(work, 'webview-data');
const outputLimit = 16 * 1024;
function redact(value) {
  return String(value)
    .replace(/^.*(?:token|password|secret|authorization|credential|api.?key|private.?key).*$/gim, '[REDACTED SENSITIVE LOG LINE]')
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/gi, 'https://[REDACTED]@')
    .replace(/[A-Za-z0-9+/_=-]{32,}/g, '[REDACTED OPAQUE VALUE]');
}
function capture(record, stream, chunk) {
  const combined = record[stream] + chunk;
  record[`${stream}Truncated`] ||= combined.length > outputLimit;
  if (combined.length <= outputLimit) record[stream] = combined;
  else {
    const tail = combined.slice(-outputLimit);
    const newline = tail.indexOf('\n');
    record[stream] = newline < 0 ? '' : tail.slice(newline + 1);
  }
}
async function bounded(promise, milliseconds) {
  let timer;
  try { return await Promise.race([promise.catch(() => undefined), new Promise(resolve => { timer = setTimeout(resolve, milliseconds); })]); }
  finally { clearTimeout(timer); }
}
async function stop() {
  if (browser) { await bounded(browser.close(), 4000); browser = undefined; }
  activePage = undefined;
  if (child && child.pid && child.exitCode === null && child.signalCode === null) {
    if (activeLaunch) activeLaunch.cleanupRequested = true;
    const exited = once(child, 'exit').catch(() => undefined);
    try { child.kill(); } catch (error) { if (activeLaunch) activeLaunch.cleanupError = redact(error.message); }
    await bounded(exited, 4000);
  }
  if (activeLaunch && child) { activeLaunch.finalExitCode = child.exitCode; activeLaunch.finalSignal = child.signalCode; activeLaunch.stillRunningAfterCleanup = Boolean(child.pid && child.exitCode === null && child.signalCode === null); }
  child = undefined;
}
async function launch(args = []) {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const record = { attempt: launches.length + 1, startedAt: new Date().toISOString(), port, startupTimeoutMs, phase: 'starting', stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false };
  launches.push(record);
  activeLaunch = record;
  child = spawn(join(root, 'dist-native', 'liubai', 'liubai-win_x64.exe'), [
    '--window-hidden=true', '--window-use-saved-state=false', '--window-width=1180', '--window-height=820', ...args,
  ], {
    cwd: join(root, 'dist-native', 'liubai'),
    windowsHide: true,
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}${process.env.CI ? ' --disable-gpu' : ''}`,
      WEBVIEW2_USER_DATA_FOLDER: webviewData,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  record.pid = child.pid ?? null;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => capture(record, 'stdout', chunk));
  child.stderr.on('data', chunk => capture(record, 'stderr', chunk));
  child.on('error', error => { record.spawnError = redact(error.message); errors.push(`Launch: ${record.spawnError}`); });
  child.on('exit', (code, signal) => { record.exitedAt = new Date().toISOString(); record.exitCode = code; record.signal = signal; });
  child.on('close', (code, signal) => { record.closedAt = new Date().toISOString(); record.closeCode = code; record.closeSignal = signal; });
  let connected = false;
  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(Math.max(1, Math.min(1000, deadline - Date.now()))) });
      if (response.ok) { connected = true; break; }
    } catch { /* The native host is still starting. */ }
    if (record.spawnError) throw new Error(`Native host failed to launch: ${record.spawnError}`);
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Native host exited with code ${child.exitCode}, signal ${child.signalCode}`);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, Math.min(250, deadline - Date.now()))));
  }
  if (!connected) { record.phase = 'webview-startup-timeout'; throw new Error(`WebView2 did not start within ${startupTimeoutMs / 1000} seconds.`); }
  record.phase = 'connecting-cdp';
  record.connectedAt = new Date().toISOString();
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: startupTimeoutMs });
  record.phase = 'waiting-for-page';
  let page;
  for (let attempt = 0; attempt < 40; attempt++) {
    page = browser.contexts().flatMap(context => context.pages()).find(tab => tab.url().startsWith('http:'));
    if (page) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!page) throw new Error('Native application page was not found.');
  page.setDefaultTimeout(12000);
  activePage = page;
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true', { timeout: 15000 });
  record.phase = 'ready';
  return page;
}
async function delayNextReplacement(page) {
  await page.evaluate(() => {
    window.__liubaiDelayedMove = false;
    const originalSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      const request = typeof data === 'string' ? JSON.parse(data) : null;
      if (request?.method === 'filesystem.move') {
        WebSocket.prototype.send = originalSend;
        window.__liubaiDelayedMove = true;
        setTimeout(() => originalSend.call(this, data), 700);
        return;
      }
      return originalSend.call(this, data);
    };
  });
}
async function enterSourceEditor(page) {
  if (await page.locator('#edit-button').getAttribute('aria-pressed') !== 'true') await page.locator('#edit-button').click();
  if (await page.locator('#source-edit-button').getAttribute('aria-pressed') !== 'true') await page.locator('#source-edit-button').click();
  await expect(page.getByRole('textbox', { name: 'Markdown编辑器', exact: true })).toBeVisible();
}
try {
  let page = await launch();
  const dataPath = await page.evaluate(() => globalThis.NL_DATAPATH);
  if (typeof dataPath !== 'string' || basename(resolve(dataPath)) !== 'app.liubai.reader') throw new Error('Unexpected native data path; preferences were not modified.');
  storageBackup = await Promise.all(['preferences', 'recent'].map(async key => {
    const path = join(dataPath, '.storage', `${key}.neustorage`);
    try { return { path, content: await readFile(path) }; }
    catch (error) { if (error.code === 'ENOENT') return { path, content: null }; throw error; }
  }));
  await page.locator('#appearance-button').click();
  await page.locator('#reset-appearance').click();
  await page.locator('#appearance-button').click();
  await new Promise(resolve => setTimeout(resolve, 250));
  await stop();
  page = await launch([filename]);
  await expect(page.locator('#document-name')).toHaveText('原生 测试.md');
  await expect(page.locator('#article h1')).toHaveText('原生中文阅读');
  checks.push('Packaged Windows executable launches; argv opens a UTF-8 BOM document with Chinese/spaces in its path.');
  await expect(page.locator('#article img')).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect.poll(() => page.locator('#article img').evaluate(img => img.naturalWidth)).toBe(512);
  checks.push('Relative local image with a Chinese path is decoded by the native filesystem.');
  await page.locator('#edit-button').click();
  await expect(page.locator('#rich-host .rich-image img')).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect.poll(() => page.locator('#rich-host .rich-image img').evaluate(img => img.naturalWidth)).toBe(512);
  await expect(page.locator('#title-dirty')).toBeHidden();
  await page.locator('#edit-button').click();
  expect(await readFile(filename, 'utf8')).toBe('\uFEFF' + content);
  checks.push('The visual native editor resolves the same relative local image and preserves untouched original bytes.');
  await page.locator('#find-button').click();
  await page.locator('#search-input').fill('原生');
  await expect(page.locator('#search-count')).toContainText('/ 2');
  await page.locator('#search-close').click();
  checks.push('Find highlights document text inside native WebView2.');
  await page.locator('#appearance-button').click();
  await page.locator('button[data-theme="dark"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('#font-plus').click();
  await expect(page.locator('#font-size')).toHaveText('18');
  await page.locator('#appearance-button').click();
  await new Promise(resolve => setTimeout(resolve, 250));
  await stop();

  page = await launch();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('#appearance-button').click();
  await expect(page.locator('#font-size')).toHaveText('18');
  await page.locator('#appearance-button').click();
  checks.push('Theme and font-size settings survive closing and reopening the native process with a new server port.');
  await page.locator('#files-tab').click();
  await page.locator('[data-recent]').filter({ hasText: '原生 测试.md' }).click();
  await expect(page.locator('#article h1')).toHaveText('原生中文阅读');
  checks.push('Recent files persist and reopen through the native filesystem.');
  await writeFile(filename, content + '\n## 更新后的内容\n\n读取磁盘的最新版本。');
  await page.locator('#more-button').click();
  await page.locator('#refresh-button').click();
  await expect(page.locator('#article')).toContainText('更新后的内容');
  checks.push('Refresh reads changes from disk without writing to the source file.');
  await page.evaluate(path => window.dispatchEvent(new CustomEvent('filesDropped', { detail: [path] })), dropped);
  await expect(page.locator('#document-name')).toHaveText('拖入的文档.md');
  await expect(page.locator('#article h1')).toHaveText('拖入的新文档');
  checks.push('Native filesDropped event handler opens a real file (event simulated; OS drag gesture not automated).');
  await page.evaluate(path => window.dispatchEvent(new CustomEvent('filesDropped', { detail: [path] })), visualFile);
  await expect(page.locator('#document-name')).toHaveText('可视正文.md');
  await page.locator('#edit-button').click();
  const rich = page.getByRole('textbox', { name: '可视编辑器', exact: true });
  await expect(rich).toBeVisible();
  await expect(page.locator('#source-edit-button')).toHaveAttribute('aria-pressed', 'false');
  await expect(rich.locator('h1')).toHaveText('可视原生编辑');
  await expect(rich.locator('strong')).toHaveText('原有加粗');
  await expect(page.locator('#title-dirty')).toBeHidden();
  expect(await readFile(visualFile, 'utf8')).toBe(visualOriginal);
  checks.push('Native editing opens rendered, directly editable Markdown without dirtying or rewriting the original file.');

  const paragraph = rich.locator('p').filter({ hasText: '普通段落，保留原文。' });
  await paragraph.click();
  await rich.press('End');
  await rich.press('Control+b');
  await page.keyboard.insertText('可视加粗追加');
  await rich.press('Control+b');
  await expect(rich.locator('strong').filter({ hasText: '可视加粗追加' })).toBeVisible();
  await expect(page.locator('#title-dirty')).toBeVisible();
  await page.locator('#source-edit-button').click();
  const source = page.getByRole('textbox', { name: 'Markdown编辑器', exact: true });
  await expect(source).toContainText('**可视加粗追加**');
  await expect(source).toContainText('| 原生 | 正常 |');
  await page.locator('#source-edit-button').click();
  await expect(rich.locator('strong').filter({ hasText: '可视加粗追加' })).toBeVisible();
  await rich.press('Control+s');
  await expect(page.locator('#save-state')).toHaveText('已保存');
  const visualSaved = await readFile(visualFile, 'utf8');
  expect(visualSaved).toContain('**可视加粗追加**');
  expect(visualSaved).toContain('| 原生 | 正常 |');
  await rich.press('Control+z');
  await expect(page.locator('#title-dirty')).toBeVisible();
  await rich.press('Control+Shift+z');
  await expect(page.locator('#title-dirty')).toBeHidden();
  expect(await readFile(visualFile, 'utf8')).toBe(visualSaved);
  checks.push('Visual formatting survives source/visual switching and real UTF-8 disk save; undo/redo remains available after saving.');
  await page.locator('#more-button').click();
  await page.locator('#refresh-button').click();
  await expect(rich.locator('strong').filter({ hasText: '可视加粗追加' })).toBeVisible();
  await expect(page.locator('#title-dirty')).toBeHidden();
  checks.push('Reopening the saved native document restores rendered formatting without marking it modified.');

  await page.evaluate(path => window.dispatchEvent(new CustomEvent('filesDropped', { detail: [path] })), dropped);
  await expect(page.locator('#document-name')).toHaveText('拖入的文档.md');
  await enterSourceEditor(page);
  const editor = page.getByRole('textbox', { name: 'Markdown编辑器', exact: true });
  const revised = '# 已保存的中文编辑\n\n编辑器写入了真实磁盘文件。\n';
  await editor.fill(revised);
  await expect(page.locator('#title-dirty')).toBeVisible();
  await editor.press('Control+s');
  await expect(page.locator('#save-state')).toHaveText('已保存');
  expect(await readFile(dropped, 'utf8')).toBe(revised);
  expect((await readdir(work)).filter(name => name.includes('.liubai-'))).toEqual([]);
  checks.push('Editing and Ctrl+S atomically replace the real Markdown file, verify UTF-8 content, and clean temporary files.');

  const myVersion = '# 我的编辑\n\n应保留在编辑器中的内容。\n';
  const external = '# 外部修改\n';
  await editor.fill(myVersion);
  await writeFile(dropped, external);
  await page.locator('#save-button').click();
  await expect(page.locator('#dialog-title')).toHaveText('文件在别处发生了变化');
  expect(await readFile(dropped, 'utf8')).toBe(external);
  await page.locator('[data-decision="cancel"]').click();
  await expect(page.locator('#title-dirty')).toBeVisible();
  await expect(editor).toContainText('我的编辑');
  checks.push('External disk changes are detected; cancelling keeps the external file and the unsaved editor content.');
  await page.locator('#save-button').click();
  await expect(page.locator('#dialog-title')).toHaveText('文件在别处发生了变化');
  await page.locator('[data-decision="discard"]').click();
  await expect(page.locator('#save-state')).toHaveText('已保存');
  expect(await readFile(dropped, 'utf8')).toBe(myVersion);
  checks.push('Explicitly confirmed conflict overwrite writes and verifies the chosen editor version.');

  const reopened = '# 重新打开前保存\n\n重新打开仍显示刚保存的版本。\n';
  await editor.fill(reopened);
  await page.evaluate(path => window.dispatchEvent(new CustomEvent('filesDropped', { detail: [path] })), dropped);
  await expect(page.locator('#dialog-title')).toHaveText('保存修改？');
  await page.locator('[data-decision="save"]').click();
  await expect(page.locator('#save-state')).toHaveText('已保存');
  await expect(page.locator('#article h1')).toHaveText('重新打开前保存');
  expect(await readFile(dropped, 'utf8')).toBe(reopened);
  checks.push('Reopening a dirty file and choosing Save retains the freshly saved version instead of an older read snapshot.');

  const savingSnapshot = '# 保存中的版本\n';
  const laterEdit = '# 保存过程中继续写下的版本\n';
  await editor.fill(savingSnapshot);
  await delayNextReplacement(page);
  await page.locator('#save-button').click();
  await page.waitForFunction(() => window.__liubaiDelayedMove);
  await editor.fill(laterEdit);
  await expect(page.locator('#save-state')).toHaveText('未保存');
  expect(await readFile(dropped, 'utf8')).toBe(savingSnapshot);
  await expect(editor).toContainText('保存过程中继续写下的版本');
  await page.locator('#save-button').click();
  await expect(page.locator('#save-state')).toHaveText('已保存');
  expect(await readFile(dropped, 'utf8')).toBe(laterEdit);
  checks.push('Edits made during a delayed real save stay dirty; a second save writes those later edits.');

  const reopenedDuringSave = '# 保存中重新打开仍保留新内容\n';
  await editor.fill(reopenedDuringSave);
  await delayNextReplacement(page);
  await page.locator('#save-button').click();
  await page.waitForFunction(() => window.__liubaiDelayedMove);
  await page.evaluate(path => window.dispatchEvent(new CustomEvent('filesDropped', { detail: [path] })), dropped);
  await expect(page.locator('#save-state')).toHaveText('已保存');
  await expect(page.locator('#article h1')).toHaveText('保存中重新打开仍保留新内容');
  expect(await readFile(dropped, 'utf8')).toBe(reopenedDuringSave);
  checks.push('Opening the same file while a real save is delayed does not restore a stale disk snapshot.');

  await page.evaluate(path => window.dispatchEvent(new CustomEvent('filesDropped', { detail: [path] })), readonly);
  await expect(page.locator('#document-name')).toHaveText('只读文档.md');
  await enterSourceEditor(page);
  await editor.fill('# 只读文件的未保存编辑\n');
  await page.locator('#save-button').click();
  await expect(page.locator('#toast')).toContainText('检查权限');
  await expect(page.locator('#title-dirty')).toBeVisible();
  expect(await readFile(readonly, 'utf8')).toBe('# 只读原文\n');
  checks.push('Read-only write failure preserves both the original disk file and the dirty editor content.');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('windowClose')));
  await expect(page.locator('#unsaved-dialog')).toBeVisible();
  expect(await page.locator('.workspace').evaluate(element => element.inert)).toBe(true);
  await page.locator('[data-decision="cancel"]').click();
  await expect.poll(() => page.locator('.workspace').evaluate(element => element.inert)).toBe(false);
  expect(child.exitCode).toBeNull();
  await expect(page.locator('#title-dirty')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('windowClose')));
  await expect(page.locator('#unsaved-dialog')).toBeVisible();
  await page.locator('[data-decision="save"]').click();
  await expect(page.locator('#toast')).toContainText('检查权限');
  await expect.poll(() => page.locator('.workspace').evaluate(element => element.inert)).toBe(false);
  expect(child.exitCode).toBeNull();
  await expect(page.locator('#title-dirty')).toBeVisible();
  checks.push('Native windowClose cancellation and failed save both keep the process open with its dirty content.');
  await page.locator('#more-button').click();
  await page.locator('#refresh-button').click();
  await expect(page.locator('#unsaved-dialog')).toBeVisible();
  await page.locator('[data-decision="discard"]').click();
  await expect(page.locator('#title-dirty')).toBeHidden();

  await page.evaluate(path => window.dispatchEvent(new CustomEvent('filesDropped', { detail: [path] })), utf16);
  await expect(page.locator('#document-name')).toHaveText('UTF16文档.md');
  await enterSourceEditor(page);
  await expect(editor).toContainText('UTF16原文');
  const converted = '# UTF16编辑后\n\n保存为UTF-8。\n';
  await editor.fill(converted);
  await page.locator('#save-button').click();
  await expect(page.locator('#save-state')).toHaveText('已保存');
  expect(await readFile(utf16)).toEqual(Buffer.from(converted, 'utf8'));
  checks.push('A UTF-16 BOM document can be edited and saved as verified UTF-8 bytes.');
  await page.locator('#appearance-button').click();
  await page.locator('#reset-appearance').click();
  await page.locator('#appearance-button').click();
  await page.locator('#files-tab').click();
  await page.locator('#clear-recent').click();
  await new Promise(resolve => setTimeout(resolve, 250));
  const finalText = '# 关闭前保存\n\n关闭时完成写入。\n';
  await editor.fill(finalText);
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('windowClose'));
    window.dispatchEvent(new CustomEvent('windowClose'));
  });
  await expect(page.locator('#unsaved-dialog')).toBeVisible();
  const exited = once(child, 'exit');
  await page.locator('[data-decision="save"]').click();
  await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error('Approved native close did not exit.')), 7000))]);
  expect(child.exitCode).toBe(0);
  expect(await readFile(utf16, 'utf8')).toBe(finalText);
  checks.push('A repeated native windowClose request displays one guard and exits only after successful final save.');
  if (errors.length) throw new Error(errors.join('\n'));
  const result = { platform: 'Windows x64 / real WebView2', artifact, passed: true, checks, errors, macOSNativeTested: false, note: 'Hidden native WebView2 cannot capture compositor screenshots; visual QA uses the browser rendering of the same application.' };
  await writeFile(join(work, 'results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  failed = true;
  if (process.env.CI && activeLaunch && child?.pid) {
    const processState = spawnSync('powershell.exe', ['-NoProfile', '-Command',
      `Get-Process -Id ${child.pid} -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, SessionId, MainWindowTitle | ConvertTo-Json -Compress; Get-Process msedgewebview2 -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, SessionId | ConvertTo-Json -Compress`,
    ], { windowsHide: true, encoding: 'utf8', timeout: 5000, maxBuffer: outputLimit });
    activeLaunch.processState = redact(processState.stdout || processState.error?.message || 'No process information available.');
  }
  const diagnostic = activePage ? await bounded(activePage.evaluate(() => ({ mode: globalThis.NL_MODE, toast: document.querySelector('#toast')?.textContent, globalsInjected: globalThis.NL_GINJECTED })), 1500) : undefined;
  await writeFile(join(work, 'results.json'), JSON.stringify({ artifact, passed: false, checks, errors, diagnostic, error: error.message }, null, 2));
  throw error;
} finally {
  await stop();
  if (failed) {
    const diagnostic = { startupTimeoutMs, nodeVersion: process.version, launches: launches.map(record => ({ ...record, stdout: redact(record.stdout), stderr: redact(record.stderr) })) };
    await writeFile(join(work, 'launch-diagnostics.json'), JSON.stringify(diagnostic, null, 2)).catch(() => console.warn('Could not write sanitized launch diagnostics.'));
    console.log('Native launch diagnostics: test-results/native/launch-diagnostics.json');
  }
  await chmod(readonly, 0o644).catch(() => {});
  if (storageBackup) for (const entry of storageBackup) {
    if (entry.content === null) await unlink(entry.path).catch(error => { if (error.code !== 'ENOENT') throw error; });
    else {
      await writeFile(entry.path, entry.content);
      if (!(await readFile(entry.path)).equals(entry.content)) throw new Error('Native settings did not restore byte-for-byte.');
    }
  }
  if (storageBackup) {
    const reportPath = join(work, 'results.json');
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    report.settingsRestored = true;
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log('Preexisting native preferences and recent files restored.');
  }
}
