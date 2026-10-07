import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

type DocumentFixture = { name: string; content: string | Buffer };

async function captureScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const folder = `test-results/${testInfo.config.metadata.testEngine}/screenshots`;
  await mkdir(folder, { recursive: true });
  await mkdir('test-results/screenshots', { recursive: true });
  const pixels = await page.screenshot({ path: `${folder}/${name}.png` });
  await writeFile(`test-results/screenshots/${name}.png`, pixels);
}

async function openDocuments(page: Page, ...documents: DocumentFixture[]) {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#open-file').click();
  const chooser = await chooserPromise;
  await chooser.setFiles(documents.map(({ name, content }) => ({
    name,
    mimeType: 'text/markdown',
    buffer: typeof content === 'string' ? Buffer.from(content, 'utf8') : content,
  })));
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('heading', { name: '留一点空白，给思考。', exact: true })).toBeVisible();
});

test('opens the welcome document with readable rich Markdown', async ({ page }, testInfo) => {
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.locator('#article .katex').first()).toBeVisible();
  await expect(page.locator('#article .code-block pre code')).toContainText('const pause');
  await expect(page.locator('#article input[type="checkbox"]:checked')).toHaveCount(2);
  await expect(page.locator('#article input[type="checkbox"]')).toHaveCount(3);
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(horizontalOverflow).toBe(false);
  await expect(page.locator('#save-state')).toHaveText('本地文档');
  await page.setViewportSize({ width: 1280, height: 860 });
  await captureScreenshot(page, testInfo, 'welcome-light');
  await page.locator('#appearance-button').click();
  await page.locator('button[data-theme="dark"]').click();
  await captureScreenshot(page, testInfo, 'welcome-dark-settings');
});

test('opens UTF-8 Markdown through the actual file picker', async ({ page }) => {
  await openDocuments(page, { name: '中文笔记.md', content: '# 中文笔记\n\n一段新的文字。\n\n## 第二节\n\n**重要内容**' });
  await expect(page.getByRole('heading', { name: '中文笔记', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '第二节', exact: true })).toBeVisible();
  await expect(page.locator('#article strong', { hasText: '重要内容' })).toBeVisible();
});

test('opens, switches, and closes documents while preserving the active document', async ({ page }) => {
  await openDocuments(page,
    { name: '第一篇.md', content: '# 第一篇\n\n独立的甲内容。' },
    { name: '第二篇.markdown', content: '# 第二篇\n\n独立的乙内容。' },
  );
  await expect(page.locator('#document-name')).toHaveText('第二篇.markdown');
  await expect(page.locator('#file-count')).toHaveText('3');
  await page.locator('#files-tab').click();
  await page.locator('#file-list').getByRole('button', { name: '第一篇.md', exact: true }).click();
  await expect(page.locator('#article')).toContainText('独立的甲内容。');
  await expect(page.locator('#article')).not.toContainText('独立的乙内容。');
  await page.locator('#file-list').getByRole('button', { name: '第二篇.markdown', exact: true }).click();
  await expect(page.locator('#article')).toContainText('独立的乙内容。');
  await page.locator('#file-list').getByRole('button', { name: '欢迎使用.md', exact: true }).click();
  await expect(page.getByRole('heading', { name: '留一点空白，给思考。' })).toBeVisible();
  await page.getByRole('button', { name: '关闭 第一篇.md', exact: true }).click();
  await expect(page.locator('#file-count')).toHaveText('2');
  await expect(page.locator('#document-name')).toHaveText('欢迎使用.md');
  await expect(page.locator('#file-list').getByRole('button', { name: '第一篇.md', exact: true })).toHaveCount(0);
  await page.locator('#file-list').getByRole('button', { name: '第二篇.markdown', exact: true }).click();
  await expect(page.locator('#article')).toContainText('独立的乙内容。');
  await page.getByRole('button', { name: '关闭 第二篇.markdown', exact: true }).click();
  await expect(page.locator('#file-count')).toHaveText('1');
  await expect(page.locator('#document-name')).toHaveText('欢迎使用.md');
  await expect(page.locator('#file-list .close-file')).toHaveCount(0);
});

test('copying a highlighted code block writes the exact plain text to the clipboard', async ({ page }) => {
  const code = 'const greeting = "<hello>";\nconsole.log(greeting);\n';
  await openDocuments(page, { name: '复制代码.md', content: `# 复制代码\n\n\`\`\`javascript\n${code}\`\`\`` });
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => { (window as unknown as { copiedText: string }).copiedText = text; } },
    });
  });
  await page.locator('#article').getByRole('button', { name: '复制代码', exact: true }).click();
  await expect(page.locator('#toast')).toHaveText('代码已复制');
  expect(await page.evaluate(() => (window as unknown as { copiedText: string }).copiedText)).toBe(code);
});

test('outline scrolls to the selected heading and reading progress reaches the end', async ({ page }) => {
  const body = Array.from({ length: 40 }, (_, index) => `第 ${index + 1} 段。文字留在这里，给阅读一些空间。`).join('\n\n');
  await openDocuments(page, { name: '长文.md', content: `# 长文\n\n${body}\n\n## 最后一节\n\n终于读到了这里。` });
  await page.locator('#outline').getByRole('button', { name: '最后一节', exact: true }).click();
  await expect.poll(() => page.locator('#reader').evaluate(el => el.scrollTop)).toBeGreaterThan(600);
  await expect(page.getByRole('heading', { name: '最后一节', exact: true })).toBeInViewport();
  await expect(page.locator('#outline button.active')).toHaveText('最后一节');
  await page.locator('#reader').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(page.locator('#read-progress')).toHaveText('100%');
  await page.locator('#back-top').click();
  await expect.poll(() => page.locator('#reader').evaluate(el => el.scrollTop)).toBe(0);
});

test('find highlights all occurrences and supports next, previous, wrap, and dismissal', async ({ page }) => {
  await openDocuments(page, { name: '搜索.md', content: '# 搜索测试\n\n风吹过，风吹过。\n\n## 后面\n\n风吹过。' });
  await page.keyboard.press('Control+f');
  await expect(page.locator('#search-input')).toBeFocused();
  await page.locator('#search-input').fill('风吹过');
  await expect(page.locator('#search-count')).toHaveText('1 / 3');
  await expect(page.locator('mark.search-result')).toHaveCount(3);
  await page.locator('#search-next').click();
  await expect(page.locator('#search-count')).toHaveText('2 / 3');
  await page.locator('#search-prev').click();
  await expect(page.locator('#search-count')).toHaveText('1 / 3');
  await page.locator('#search-prev').click();
  await expect(page.locator('#search-count')).toHaveText('3 / 3');
  await page.locator('#search-input').press('Enter');
  await expect(page.locator('#search-count')).toHaveText('1 / 3');
  await page.locator('#search-input').fill('没有这个词');
  await expect(page.locator('#search-count')).toHaveText('0 / 0');
  await expect(page.locator('#search-next')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('#findbar')).toBeHidden();
  await expect(page.locator('mark.search-result')).toHaveCount(0);
  await expect(page.locator('#article')).toContainText('风吹过，风吹过。');
});

test('find matches readable phrases across inline formatting and restores formatting', async ({ page }) => {
  await openDocuments(page, { name: '跨格式搜索.md', content: '# 跨格式搜索\n\n跳**过**空白，再跳*过*空白。' });
  await page.locator('#find-button').click();
  await page.locator('#search-input').fill('跳过空白');
  await expect(page.locator('#search-count')).toHaveText('1 / 2');
  await expect(page.locator('#article strong')).toHaveText('过');
  await page.locator('#search-next').click();
  await expect(page.locator('#search-count')).toHaveText('2 / 2');
  await page.locator('#search-close').click();
  await expect(page.locator('#article strong')).toHaveText('过');
  await expect(page.locator('#article em')).toHaveText('过');
  await expect(page.locator('#article p')).toHaveText('跳过空白，再跳过空白。');
});

test('dragging Markdown into the window opens it and clears the drop overlay', async ({ page }) => {
  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['# 拖入的文章\n\n已经通过拖放打开。'], '拖放.md', { type: 'text/markdown' }));
    return transfer;
  });
  await page.locator('body').dispatchEvent('dragenter', { dataTransfer });
  await expect(page.locator('#drop-overlay')).toBeVisible();
  await page.locator('body').dispatchEvent('drop', { dataTransfer });
  await expect(page.getByRole('heading', { name: '拖入的文章', exact: true })).toBeVisible();
  await expect(page.locator('#document-name')).toHaveText('拖放.md');
  await expect(page.locator('#drop-overlay')).toBeHidden();
  await dataTransfer.dispose();
});

test('reading settings change the document and persist across reloads', async ({ page }) => {
  await page.locator('#appearance-button').click();
  for (const theme of ['paper', 'dark', 'light']) {
    await page.locator(`button[data-theme="${theme}"]`).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.locator(`button[data-theme="${theme}"]`)).toHaveAttribute('aria-pressed', 'true');
  }
  await page.locator('button[data-theme="paper"]').click();
  await page.locator('#font-plus').click();
  await page.locator('#font-plus').click();
  await expect(page.locator('#font-size')).toHaveText('19');
  await page.locator('button[data-font="serif"]').click();
  await page.locator('button[data-width="wide"]').click();
  await expect(page.locator('#article')).toHaveCSS('font-size', '19px');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper');
  await expect(page.locator('html')).toHaveAttribute('data-width', 'wide');
  await expect(page.locator('html')).toHaveAttribute('data-font', 'serif');
  await expect(page.locator('#article')).toHaveCSS('font-size', '19px');
  await page.locator('#appearance-button').click();
  await page.locator('#reset-appearance').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('#font-size')).toHaveText('17');
});

test('system theme follows operating-system appearance changes', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.locator('#appearance-button').click();
  await page.locator('#system-theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('source view remains read-only and keyboard navigation restores reading', async ({ page }) => {
  const content = '# 源文\n\n**格式内容**\n\n```js\nconst x = 1;\n```';
  await openDocuments(page, { name: '源文.md', content });
  await page.keyboard.press('Control+Shift+m');
  await expect(page.locator('#source-view')).toBeVisible();
  await expect(page.locator('#source-view')).toHaveText(content);
  await expect(page.locator('#article')).toBeHidden();
  await expect(page.locator('#view-status')).toHaveText('源文 · 只读');
  expect(await page.locator('#source-view').evaluate(el => el.isContentEditable)).toBe(false);
  await page.keyboard.press('Control+f');
  await expect(page.locator('#article')).toBeVisible();
  await expect(page.locator('#source-view')).toBeHidden();
  await expect(page.locator('#search-input')).toBeFocused();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Backslash');
  await expect(page.locator('#app')).toHaveClass(/sidebar-hidden/);
  await expect(page.locator('#toggle-sidebar')).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Control+Backslash');
  await expect(page.locator('#app')).not.toHaveClass(/sidebar-hidden/);
});

test('exports a standalone HTML file with embedded math fonts and no app controls', async ({ page, context }, testInfo) => {
  await openDocuments(page, { name: '导出测试.md', content: '# 导出测试\n\n正文 **加粗**。\n\n```js\nconst exported = true;\n```\n\n$e^{i\\pi}+1=0$' });
  await page.locator('#find-button').click();
  await page.locator('#search-input').fill('正文');
  await page.locator('#more-button').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-button').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('导出测试.html');
  const downloadPath = testInfo.outputPath('exported.html');
  await download.saveAs(downloadPath);
  const html = await readFile(downloadPath, 'utf8');
  expect(html).toContain('<!doctype html>');
  expect(html).toContain('导出测试');
  expect(html).toContain('<strong>加粗</strong>');
  expect(html).toContain('exported');
  expect(html).not.toContain('<button');
  expect(html).not.toContain('<mark');
  expect(html).not.toContain('<script');
  expect(html).toContain('Content-Security-Policy');
  expect(html).toContain('data:font/woff2;base64,');
  const exportedPage = await context.newPage();
  await exportedPage.goto(pathToFileURL(downloadPath).toString());
  await expect(exportedPage.getByRole('heading', { name: '导出测试' })).toBeVisible();
  await expect(exportedPage.locator('.katex')).toBeVisible();
  await exportedPage.evaluate(() => document.fonts.ready);
  expect(await exportedPage.evaluate(() => document.fonts.check('16px KaTeX_Math'))).toBe(true);
  await exportedPage.close();
});

test('print shortcut requests printing and switches source back to reading', async ({ page }) => {
  await page.evaluate(() => {
    (window as unknown as { printCalls: number }).printCalls = 0;
    window.print = () => { (window as unknown as { printCalls: number }).printCalls += 1; };
  });
  await page.keyboard.press('Control+Shift+m');
  await page.keyboard.press('Control+p');
  expect(await page.evaluate(() => (window as unknown as { printCalls: number }).printCalls)).toBe(1);
  await expect(page.locator('#source-view')).toBeHidden();
  await expect(page.locator('#article')).toBeVisible();
});

test('untrusted Markdown cannot create executable HTML or dangerous links', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  const payload = '# constructor\n\n<script>alert("script")</script>\n\n<img src=x onerror=alert("image")>\n\n[危险](javascript:alert(1))\n\n![危险图片](data:image/svg+xml,%3Csvg%20onload=alert(1)%3E)\n\n```html\n<script>alert("code")</script>\n```';
  await openDocuments(page, { name: '不可信内容.md', content: payload });
  await expect(page.locator('#article h1')).toHaveAttribute('id', 'heading-constructor');
  await expect(page.locator('#article script,#article iframe,#article object,#article [onerror],#article [onload]')).toHaveCount(0);
  await expect(page.locator('#article a[href^="javascript:"],#article img[src^="data:image/svg"]')).toHaveCount(0);
  await expect(page.locator('#article')).toContainText('<script>alert("script")</script>');
  expect(dialogs).toEqual([]);
});

test('empty documents and repeated headings keep navigation usable', async ({ page }) => {
  await openDocuments(page, { name: '空白.md', content: '' });
  await expect(page.locator('#article')).toContainText('这份文档还是空白的');
  await expect(page.locator('#word-count')).toHaveText('0 字');
  await expect(page.locator('#outline')).toContainText('还没有章节标题');
  await openDocuments(page, { name: '重复标题.md', content: '# 同名\n\n## 同名\n\n## 同名-2\n\n## \n' });
  const ids = await page.locator('#article :is(h1,h2,h3)').evaluateAll(elements => elements.map(element => element.id));
  expect(new Set(ids).size).toBe(ids.length);
  await expect(page.locator('#outline button')).toHaveCount(4);
  const labels = await page.locator('#outline button').allTextContents();
  expect(labels.every(label => label.trim().length > 0)).toBe(true);
});

test('UTF-16 files decode correctly and rejected files preserve the current document', async ({ page }) => {
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('# 编码正确\n\n中文没有乱码。', 'utf16le')]);
  await openDocuments(page, { name: '编码.md', content: utf16 });
  await expect(page.getByRole('heading', { name: '编码正确' })).toBeVisible();
  await openDocuments(page, { name: '损坏.md', content: Buffer.from([0xff, 0x00, 0x80, 0xc0]) });
  await expect(page.locator('#toast')).toContainText('文件编码无法识别');
  await expect(page.getByRole('heading', { name: '编码正确' })).toBeVisible();
  await openDocuments(page, { name: '程序.exe', content: 'not markdown' });
  await expect(page.locator('#toast')).toContainText('请选择 Markdown 或纯文本文件');
  await expect(page.locator('#document-name')).toHaveText('编码.md');
});

test('narrow windows keep text and controls within the viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 740, height: 900 });
  await openDocuments(page, { name: '窄窗口.md', content: `# 小一点的窗口\n\n仍然可以舒服地阅读。\n\n\`\`\`text\n${'long-code-line-'.repeat(40)}\n\`\`\`\n\n| 甲 | 乙 |\n| --- | --- |\n| 测试 | 内容 |` });
  await expect(page.locator('#app')).toHaveClass(/sidebar-hidden/);
  await expect(page.getByRole('heading', { name: '小一点的窗口' })).toBeInViewport();
  const sizes = await page.evaluate(() => ({ pageWidth: document.documentElement.scrollWidth, viewport: innerWidth, readerWidth: document.querySelector('#reader')!.scrollWidth, readerClient: document.querySelector('#reader')!.clientWidth }));
  expect(sizes.pageWidth).toBeLessThanOrEqual(sizes.viewport);
  expect(sizes.readerWidth).toBeLessThanOrEqual(sizes.readerClient + 1);
  await page.locator('#appearance-button').click();
  const box = await page.locator('#appearance-panel').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(740);
  await page.locator('#appearance-button').click();
  await captureScreenshot(page, testInfo, 'narrow-window');
});
