import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const lineStart = process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home';
const lineEnd = process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End';
const visual = (page: Page) => page.getByRole('textbox', { name: '可视编辑器', exact: true });
const source = (page: Page) => page.getByRole('textbox', { name: 'Markdown编辑器', exact: true });

async function captureScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const directory = `test-results/${testInfo.config.metadata.testEngine}/screenshots`;
  await mkdir(directory, { recursive: true });
  await mkdir('test-results/screenshots', { recursive: true });
  const pixels = await page.screenshot({ path: `${directory}/${name}.png` });
  await writeFile(`test-results/screenshots/${name}.png`, pixels);
}

async function openDocuments(page: Page, ...documents: { name: string; content: string }[]) {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#open-file').click();
  await (await chooserPromise).setFiles(documents.map(({ name, content }) => ({
    name, mimeType: 'text/markdown', buffer: Buffer.from(content, 'utf8'),
  })));
}

async function enterVisualMode(page: Page) {
  if (await page.locator('#edit-button').getAttribute('aria-pressed') !== 'true') await page.locator('#edit-button').click();
  if (await page.locator('#source-edit-button').getAttribute('aria-pressed') === 'true') await page.locator('#source-edit-button').click();
  await expect(visual(page)).toBeVisible();
}

async function appendToBlock(page: Page, selector: string, text: string) {
  await visual(page).locator(selector).last().click();
  await page.keyboard.press(lineEnd);
  await page.keyboard.insertText(text);
}

async function downloadMarkdown(page: Page): Promise<string> {
  const downloadPromise = page.waitForEvent('download');
  await page.keyboard.press(`${mod}+s`);
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.md$/i);
  return readFile((await download.path())!, 'utf8');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
});

test('visual mode is one editable document canvas and edits its rendered heading directly', async ({ page }, testInfo) => {
  const content = '# 把想法，写在纸上\n\n读到一句喜欢的话，就把它留下。**重要的内容**，自然清晰。\n\n## 今天的清单\n\n- 读完一篇文章\n- 记下一个想法\n- 给自己一点空白\n\n> 慢一点，也没有关系。\n\n## 一个小片段\n\n```javascript\nconst note = "留白";\nconsole.log(note);\n```';
  await openDocuments(page, { name: '随手记.md', content });
  await enterVisualMode(page);
  await expect(visual(page)).toHaveAttribute('contenteditable', 'true');
  await expect(visual(page).locator('h1')).toHaveText('把想法，写在纸上');
  await expect(visual(page).locator('strong')).toHaveText('重要的内容');
  await expect(source(page)).toBeHidden();
  await expect(page.locator('#article')).toBeHidden();
  await expect(page.locator('#title-dirty')).toBeHidden();
  await expect(page.locator('#reading-area')).not.toHaveClass(/split-view/);
  await appendToBlock(page, 'h1', '。');
  await expect(visual(page).locator('h1')).toHaveText('把想法，写在纸上。');
  await expect(page.locator('#title-dirty')).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 860 });
  await captureScreenshot(page, testInfo, 'wysiwyg-light');
  await page.locator('#appearance-button').click();
  await page.locator('button[data-theme="dark"]').click();
  await page.locator('#appearance-button').click();
  await captureScreenshot(page, testInfo, 'wysiwyg-dark');
  await visual(page).locator('h1').click();
  const markdown = await downloadMarkdown(page);
  expect(markdown).toContain('# 把想法，写在纸上。');
  expect(markdown).toContain('**重要的内容**');
  await expect(page.locator('#save-state')).toHaveText('已下载');
});

test('typing a heading marker and applying bold produces editable formatted content', async ({ page }) => {
  await page.locator('#new-button').click();
  await expect(visual(page)).toBeVisible();
  await expect(source(page)).toBeHidden();
  await visual(page).click();
  await page.keyboard.type('# ');
  await page.keyboard.insertText('新的一页');
  await expect(visual(page).locator('h1')).toHaveText('新的一页');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('值得记住的文字');
  await page.keyboard.press(lineStart);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+ArrowRight' : 'Shift+End');
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('值得记住的文字');
  await page.keyboard.press(`${mod}+b`);
  await expect(visual(page).locator('p strong')).toHaveText('值得记住的文字');
  const markdown = await downloadMarkdown(page);
  expect(markdown).toContain('# 新的一页');
  expect(markdown).toContain('**值得记住的文字**');
});

test('lists are edited as list items and remain lists in saved Markdown', async ({ page }) => {
  await openDocuments(page, { name: '列表.md', content: '# 待办\n\n- 第一项\n- 第二项' });
  await enterVisualMode(page);
  await appendToBlock(page, 'li p', '，补充说明');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('第三项');
  await expect(visual(page).locator('li')).toHaveCount(3);
  await expect(visual(page).locator('li').nth(1)).toHaveText('第二项，补充说明');
  await expect(visual(page).locator('li').nth(2)).toHaveText('第三项');
  const markdown = await downloadMarkdown(page);
  expect(markdown).toMatch(/[-*+] 第二项，补充说明/);
  expect(markdown).toMatch(/[-*+] 第三项/);
});

test('table cells can be edited directly and a new table can be inserted from the toolbar', async ({ page }) => {
  await openDocuments(page, { name: '表格.md', content: '# 阅读计划\n\n| 文章 | 状态 |\n| --- | --- |\n| 第一篇 | 待完成 |' });
  await enterVisualMode(page);
  await expect(visual(page).locator('table')).toHaveCount(1);
  const cell = visual(page).locator('table td').last();
  await cell.click();
  await page.keyboard.press(lineStart);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+ArrowRight' : 'Shift+End');
  await page.keyboard.insertText('已完成');
  await expect(cell).toHaveText('已完成');
  const markdown = await downloadMarkdown(page);
  expect(markdown).toMatch(/\|\s*第一篇\s*\|\s*已完成\s*\|/);
  await page.locator('#new-button').click();
  await page.locator('[data-format="table"]').click();
  await expect(visual(page).locator('table')).toHaveCount(1);
  await expect(visual(page).locator('table tr')).toHaveCount(3);
  await expect(visual(page).locator('table tr').first().locator('th')).toHaveCount(3);
});

test('the link toolbar keeps URL input focused and saves the selected text as a link', async ({ page }) => {
  await openDocuments(page, { name: '链接.md', content: '延伸阅读' });
  await enterVisualMode(page);
  await visual(page).locator('p').click();
  await page.keyboard.press(lineStart);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+ArrowRight' : 'Shift+End');
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('延伸阅读');
  await page.locator('[data-format="link"]').click();
  const linkInput = page.getByRole('textbox', { name: '链接地址', exact: true });
  await expect(linkInput).toBeFocused();
  await linkInput.fill('https://example.com/note');
  await page.getByRole('dialog', { name: '设置链接' }).getByRole('button', { name: '应用', exact: true }).click();
  await expect(visual(page).locator('a')).toHaveText('延伸阅读');
  await expect(visual(page).locator('a')).toHaveAttribute('href', 'https://example.com/note');
  expect(await downloadMarkdown(page)).toContain('[延伸阅读](https://example.com/note)');
});

test('task checkboxes are interactive and save their checked state as Markdown', async ({ page }) => {
  await openDocuments(page, { name: '任务.md', content: '# 今天\n\n- [ ] 完成阅读\n- [x] 整理书桌' });
  await enterVisualMode(page);
  const boxes = visual(page).getByRole('checkbox');
  await expect(boxes).toHaveCount(2);
  await boxes.first().check();
  await expect(boxes.first()).toBeChecked();
  const markdown = await downloadMarkdown(page);
  expect(markdown).toMatch(/[-*+] \[x\] 完成阅读/);
  expect(markdown).toMatch(/[-*+] \[x\] 整理书桌/);
});

test('visual drafts keep independent undo histories when switching documents', async ({ page }) => {
  await openDocuments(page,
    { name: '甲的笔记.md', content: '# 甲\n\n原始甲。' },
    { name: '乙的笔记.md', content: '# 乙\n\n原始乙。' },
  );
  await enterVisualMode(page);
  await appendToBlock(page, 'p', '修改乙。');
  await page.locator('#files-tab').click();
  await page.locator('#file-list').getByRole('button', { name: '甲的笔记.md', exact: true }).click();
  await enterVisualMode(page);
  await appendToBlock(page, 'p', '修改甲。');
  await page.locator('#file-list').getByRole('button', { name: '乙的笔记.md', exact: true }).click();
  await expect(visual(page)).toContainText('修改乙。');
  await visual(page).locator('p').click();
  await page.keyboard.press(`${mod}+z`);
  await expect(visual(page)).not.toContainText('修改乙。');
  await page.locator('#file-list').getByRole('button', { name: '甲的笔记.md', exact: true }).click();
  await expect(visual(page)).toContainText('修改甲。');
  await visual(page).locator('p').click();
  await page.keyboard.press(`${mod}+z`);
  await expect(visual(page)).not.toContainText('修改甲。');
  await page.keyboard.press(`${mod}+Shift+Z`);
  await expect(visual(page)).toContainText('修改甲。');
});

test('searching the visual document navigates matches without changing its Markdown', async ({ page }) => {
  const content = '# 搜索正文\n\n风吹过，风吹过。';
  await openDocuments(page, { name: '正文搜索.md', content });
  await enterVisualMode(page);
  await visual(page).locator('p').click();
  await page.keyboard.press(`${mod}+f`);
  await page.locator('#search-input').fill('风吹过');
  await expect(page.locator('#search-count')).toHaveText('1 / 2');
  await page.locator('#search-next').click();
  await expect(page.locator('#search-count')).toHaveText('2 / 2');
  await expect(page.locator('#title-dirty')).toBeHidden();
  await page.locator('#search-close').click();
  await expect(visual(page).locator('p')).toHaveText('风吹过，风吹过。');
  expect(await downloadMarkdown(page)).toBe(content);
});

test('switching between visual and source modes preserves formatting and current edits', async ({ page }) => {
  await openDocuments(page, { name: '往返.md', content: '# 原稿\n\n一段**重要内容**。' });
  await enterVisualMode(page);
  await appendToBlock(page, 'p', '继续写下去。');
  await page.locator('#source-edit-button').click();
  await expect(source(page)).toBeVisible();
  await expect(visual(page)).toBeHidden();
  await expect(source(page)).toContainText('**重要内容**');
  await expect(source(page)).toContainText('继续写下去。');
  await source(page).click();
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.insertText('# 从源码回来\n\n**粗体仍在**\n\n- 清单项目');
  await page.locator('#source-edit-button').click();
  await expect(source(page)).toBeHidden();
  await expect(visual(page).locator('h1')).toHaveText('从源码回来');
  await expect(visual(page).locator('strong')).toHaveText('粗体仍在');
  await expect(visual(page).locator('li')).toHaveText('清单项目');
  await appendToBlock(page, 'li p', '，已修改');
  const markdown = await downloadMarkdown(page);
  expect(markdown).toContain('# 从源码回来');
  expect(markdown).toContain('**粗体仍在**');
  expect(markdown).toContain('清单项目，已修改');
});

test('closing a modified visual document asks before discarding and cancel keeps its text', async ({ page }) => {
  await openDocuments(page, { name: '保留正文.md', content: '# 保留正文\n\n重要文字。' });
  await enterVisualMode(page);
  await appendToBlock(page, 'p', '没有保存的修改。');
  await page.locator('#files-tab').click();
  await page.getByRole('button', { name: '关闭 保留正文.md', exact: true }).click();
  await expect(page.locator('#unsaved-dialog')).toBeVisible();
  await page.locator('#unsaved-dialog [data-decision="cancel"]').click();
  await expect(visual(page)).toContainText('没有保存的修改。');
  await expect(page.locator('#save-state')).toHaveText('未保存');
});

test('visual composition input preserves Chinese text and emoji through undo and redo', async ({ page }) => {
  await openDocuments(page, { name: '中文写作.md', content: '# 中文写作\n\n原文。' });
  await enterVisualMode(page);
  await visual(page).locator('p').click();
  await page.keyboard.press(lineEnd);
  await visual(page).dispatchEvent('compositionstart', { data: '' });
  await page.keyboard.insertText('中文输入🌿');
  await visual(page).dispatchEvent('compositionend', { data: '中文输入🌿' });
  await expect(visual(page).locator('p')).toHaveText('原文。中文输入🌿');
  await page.keyboard.press(`${mod}+z`);
  await expect(visual(page).locator('p')).toHaveText('原文。');
  await page.keyboard.press(`${mod}+Shift+Z`);
  await expect(visual(page).locator('p')).toHaveText('原文。中文输入🌿');
  const markdown = await downloadMarkdown(page);
  expect(markdown).toContain('原文。中文输入🌿');
});

test('untrusted raw HTML remains inert while the document is visually editable', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await openDocuments(page, { name: '安全编辑.md', content: '# 安全文字\n\n<script>alert("bad")</script>\n\n<img src=x onerror=alert("bad")>\n\n可继续编辑的正文。' });
  await enterVisualMode(page);
  await expect(visual(page).locator('script,iframe,object,[onerror],[onload]')).toHaveCount(0);
  await appendToBlock(page, 'p', '新的文字。');
  await expect(visual(page)).toContainText('新的文字。');
  expect(dialogs).toEqual([]);
});

test('editing prose preserves inline math, block math, footnotes, and fenced code', async ({ page }) => {
  const content = '# 混合文档\n\n第一段。\n\n公式 $x^2 + y^2$。\n\n参考这段话[^ref]。\n\n[^ref]: 注释原文。\n\n$$\nE=mc^2\n$$\n\n```js\nconst value = "<safe>";\n```';
  await openDocuments(page, { name: '格式保留.md', content });
  await enterVisualMode(page);
  await visual(page).locator('p').filter({ hasText: '第一段。' }).first().click();
  await page.keyboard.press(lineEnd);
  await page.keyboard.insertText('补充文字。');
  const markdown = await downloadMarkdown(page);
  expect(markdown).toContain('第一段。补充文字。');
  expect(markdown).toContain('$x^2 + y^2$');
  expect(markdown).toMatch(/\$\$\s*E=mc\^2\s*\$\$/);
  expect(markdown).toContain('[^ref]');
  expect(markdown).toMatch(/\[\^ref\]:\s*注释原文。/);
  expect(markdown).toContain('```js');
  expect(markdown).toContain('const value = "<safe>";');
});

test('narrow windows retain a single editable canvas with no source or duplicate preview', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 740, height: 900 });
  await openDocuments(page, { name: '小窗口书写.md', content: '# 一张安静的纸\n\n在小一点的窗口里，也能直接写字。\n\n## 此刻\n\n- 读一点\n- 写一点' });
  await enterVisualMode(page);
  await appendToBlock(page, 'h1', '。');
  await expect(visual(page)).toBeInViewport();
  await expect(source(page)).toBeHidden();
  await expect(page.locator('#article')).toBeHidden();
  await expect(page.locator('#reading-area')).not.toHaveClass(/split-view/);
  const bounds = await visual(page).boundingBox();
  expect(bounds!.width).toBeGreaterThan(500);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await captureScreenshot(page, testInfo, 'wysiwyg-narrow');
  const markdown = await downloadMarkdown(page);
  expect(markdown).toContain('# 一张安静的纸。');
});
