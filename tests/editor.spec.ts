import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

const editor = (page: Page) => page.getByRole('textbox', { name: 'Markdown编辑器', exact: true });

async function captureScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const folder = `test-results/${testInfo.config.metadata.testEngine}/screenshots`;
  await mkdir(folder, { recursive: true });
  await mkdir('test-results/screenshots', { recursive: true });
  const pixels = await page.screenshot({ path: `${folder}/${name}.png` });
  await writeFile(`test-results/screenshots/${name}.png`, pixels);
}

async function openDocuments(page: Page, ...documents: { name: string; content: string }[]) {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#open-file').click();
  const chooser = await chooserPromise;
  await chooser.setFiles(documents.map(({ name, content }) => ({
    name, mimeType: 'text/markdown', buffer: Buffer.from(content, 'utf8'),
  })));
}

async function enterEditMode(page: Page) {
  if (await page.locator('#edit-button').getAttribute('aria-pressed') !== 'true') await page.locator('#edit-button').click();
  if (!(await editor(page).isVisible())) await page.locator('#source-edit-button').click();
  await expect(editor(page)).toBeVisible();
}

async function replaceText(page: Page, content: string) {
  await enterEditMode(page);
  await editor(page).click();
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.insertText(content);
}

async function appendText(page: Page, content: string) {
  await enterEditMode(page);
  await editor(page).click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
  await page.keyboard.insertText(content);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
});

test('source edits appear in visual editing and reading with the same content', async ({ page }) => {
  await openDocuments(page, { name: '编辑.md', content: '# 原始内容\n\n原来的文字。' });
  const content = '# 把想法，慢慢写下来。\n\n**新的段落**，保留中文与 emoji 🌿。\n\n## 今天的三件小事\n\n- 给自己一段安静的时间\n- 读完一篇喜欢的文章\n- 记下一点新的发现\n\n> 写下来，让思路有一个可以停留的地方。\n\n## 一个小片段\n\n```javascript\nconst words = ["慢一点", "也没关系"];\nconsole.log(words.join("，"));\n```\n\n文字、代码和公式，都可以自然地待在一起：$e^{i\\pi}+1=0$。';
  await replaceText(page, content);
  await page.locator('#source-edit-button').click();
  const visualEditor = page.getByRole('textbox', { name: '可视编辑器', exact: true });
  await expect(visualEditor).toBeVisible();
  await expect(editor(page)).toBeHidden();
  await expect(visualEditor.locator('h1')).toHaveText('把想法，慢慢写下来。');
  await expect(visualEditor.locator('strong')).toHaveText('新的段落');
  await expect(visualEditor).toContainText('保留中文与 emoji 🌿。');
  await expect(page.locator('#title-dirty')).toBeVisible();
  await expect(page).toHaveTitle(/^● 编辑\.md/);
  await visualEditor.click();
  await page.keyboard.press(`${mod}+e`);
  await expect(editor(page)).toBeHidden();
  await expect(page.locator('#article h1')).toBeVisible();
  await expect(page.locator('#document-name')).toContainText('编辑.md');
});

test('editing the built-in guide creates a draft copy and keeps the guide read-only', async ({ page }) => {
  await page.locator('#edit-button').click();
  await expect(page.locator('#document-name')).toHaveText('欢迎使用-副本.md');
  await enterEditMode(page);
  await appendText(page, '\n\n只修改副本。');
  await page.locator('#files-tab').click();
  await page.locator('#file-list').getByRole('button', { name: '欢迎使用.md', exact: true }).click();
  await expect(editor(page)).toBeHidden();
  await expect(page.locator('#article')).not.toContainText('只修改副本。');
  await page.locator('#file-list').getByRole('button', { name: '欢迎使用-副本.md', exact: true }).click();
  await enterEditMode(page);
  await expect(editor(page)).toContainText('只修改副本。');
});

test('switching files preserves separate dirty drafts and per-document undo history', async ({ page }) => {
  await openDocuments(page,
    { name: '甲.md', content: '# 甲\n\n原始甲。' },
    { name: '乙.md', content: '# 乙\n\n原始乙。' },
  );
  await appendText(page, ' 修改乙。');
  await page.locator('#files-tab').click();
  await page.locator('#file-list').getByRole('button', { name: '甲.md', exact: true }).click();
  await appendText(page, ' 修改甲。');
  await expect(page.locator('#file-list .document-dirty')).toHaveCount(2);
  await page.locator('#file-list').getByRole('button', { name: '乙.md', exact: true }).click();
  await expect(editor(page)).toContainText('修改乙。');
  await expect(editor(page)).not.toContainText('修改甲。');
  await expect(page.locator('#title-dirty')).toBeVisible();
  await editor(page).click();
  await page.keyboard.press(`${mod}+z`);
  await expect(editor(page)).toContainText('原始乙。');
  await expect(editor(page)).not.toContainText('修改乙。');
  await expect(page.locator('#title-dirty')).toBeHidden();
  await page.locator('#file-list').getByRole('button', { name: '甲.md', exact: true }).click();
  await expect(editor(page)).toContainText('修改甲。');
  await expect(page.locator('#title-dirty')).toBeVisible();
  await editor(page).click();
  await page.keyboard.press(`${mod}+z`);
  await expect(editor(page)).not.toContainText('修改甲。');
  await expect(page.locator('#title-dirty')).toBeHidden();
  await page.keyboard.press(`${mod}+Shift+Z`);
  await expect(editor(page)).toContainText('修改甲。');
  await expect(page.locator('#title-dirty')).toBeVisible();
});

test('bold formatting and Unicode composition input support undo and redo', async ({ page }) => {
  await openDocuments(page, { name: '格式.md', content: '需要加粗' });
  await enterEditMode(page);
  await editor(page).click();
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.press(`${mod}+b`);
  await expect(editor(page)).toContainText('**需要加粗**');
  await page.keyboard.press(`${mod}+z`);
  await expect(editor(page)).not.toContainText('**');
  await page.keyboard.press(`${mod}+Shift+Z`);
  await expect(editor(page)).toContainText('**需要加粗**');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
  await editor(page).dispatchEvent('compositionstart', { data: '' });
  await page.keyboard.insertText('，中文输入🌿');
  await editor(page).dispatchEvent('compositionend', { data: '，中文输入🌿' });
  await expect(editor(page)).toContainText('，中文输入🌿');
  await page.keyboard.press(`${mod}+z`);
  await expect(editor(page)).not.toContainText('中文输入');
  await page.keyboard.press(`${mod}+Shift+Z`);
  await expect(editor(page)).toContainText('，中文输入🌿');
});

test('a new document saves exact UTF-8 content through the save shortcut', async ({ page }) => {
  const content = '# 新笔记 🌿\n\n中文、English、café。\n\n- [x] 已完成\n';
  await page.keyboard.press(`${mod}+n`);
  await replaceText(page, content);
  await expect(page.locator('#save-state')).toContainText('未保存');
  const downloads: string[] = [];
  page.on('download', download => { downloads.push(download.suggestedFilename()); });
  const downloadPromise = page.waitForEvent('download');
  await page.keyboard.press(`${mod}+s`);
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.md$/i);
  expect(await readFile((await download.path())!, 'utf8')).toBe(content);
  await expect(page.locator('#save-state')).toContainText('已下载');
  await expect(page.locator('#title-dirty')).toBeHidden();
  expect(downloads).toHaveLength(1);
  await replaceText(page, content + '\n继续补充。');
  await expect(page.locator('#save-state')).toContainText('未保存');
  const saveAsPromise = page.waitForEvent('download');
  await page.keyboard.press(`${mod}+Shift+s`);
  const saveAs = await saveAsPromise;
  expect(await readFile((await saveAs.path())!, 'utf8')).toBe(content + '\n继续补充。');
  await expect(page.locator('#save-state')).toContainText('已下载');
});

test('cancelling a dirty close retains the draft and discarding removes only that document', async ({ page }) => {
  await openDocuments(page, { name: '待关闭.md', content: '# 原稿\n\n原始文字。' });
  await appendText(page, ' 尚未保存的新文字。');
  await page.locator('#files-tab').click();
  await page.getByRole('button', { name: '关闭 待关闭.md', exact: true }).click();
  await expect(page.locator('#unsaved-dialog')).toBeVisible();
  await page.locator('#unsaved-dialog [data-decision="cancel"]').click();
  await expect(page.locator('#unsaved-dialog')).toBeHidden();
  await expect(editor(page)).toContainText('尚未保存的新文字。');
  await expect(page.locator('#save-state')).toContainText('未保存');
  await page.getByRole('button', { name: '关闭 待关闭.md', exact: true }).click();
  await page.locator('#unsaved-dialog [data-decision="discard"]').click();
  await expect(page.locator('#document-name')).toHaveText('欢迎使用.md');
  await expect(page.locator('#file-count')).toHaveText('1');
});

test('saving from the dirty-close dialog downloads the latest draft before closing', async ({ page }) => {
  const content = '# 保存再关闭\n\n不能丢失的文字。';
  await openDocuments(page, { name: '保存再关闭.md', content: '# 旧标题' });
  await replaceText(page, content);
  await page.locator('#files-tab').click();
  await page.getByRole('button', { name: '关闭 保存再关闭.md', exact: true }).click();
  await expect(page.locator('#unsaved-dialog')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#unsaved-dialog [data-decision="save"]').click();
  const download = await downloadPromise;
  expect(await readFile((await download.path())!, 'utf8')).toBe(content);
  await expect(page.locator('#document-name')).toHaveText('欢迎使用.md');
  await expect(page.locator('#file-count')).toHaveText('1');
});

test('reopening the same dirty file requires a decision before replacing its draft', async ({ page }, testInfo) => {
  await mkdir(testInfo.outputDir, { recursive: true });
  const filePath = testInfo.outputPath('重复打开.md');
  await writeFile(filePath, '# 磁盘原稿\n\n原始文字。', 'utf8');
  const reopen = async () => {
    const chooserPromise = page.waitForEvent('filechooser');
    await page.locator('#open-file').click();
    await (await chooserPromise).setFiles(filePath);
  };
  await reopen();
  await appendText(page, ' 尚未保存的修改。');
  await reopen();
  await expect(page.locator('#unsaved-dialog')).toBeVisible();
  await page.locator('#unsaved-dialog [data-decision="cancel"]').click();
  await expect(editor(page)).toContainText('尚未保存的修改。');
  await reopen();
  await page.locator('#unsaved-dialog [data-decision="discard"]').click();
  await expect(editor(page)).toContainText('原始文字。');
  await expect(editor(page)).not.toContainText('尚未保存的修改。');
  await expect(page.locator('#save-state')).not.toContainText('未保存');
  await appendText(page, ' 保存后保留在编辑器。');
  await reopen();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#unsaved-dialog [data-decision="save"]').click();
  const savedDraft = await downloadPromise;
  expect(await readFile((await savedDraft.path())!, 'utf8')).toContain('保存后保留在编辑器。');
  await expect(editor(page)).toContainText('保存后保留在编辑器。');
  await expect(page.locator('#save-state')).toHaveText('已下载');
  await expect(page.locator('#file-count')).toHaveText('2');
});

test('source view and HTML export both use the latest unsaved edit', async ({ page }) => {
  const content = '# 最新草稿\n\n**尚未保存的正文**';
  await openDocuments(page, { name: '实时内容.md', content: '# 旧内容' });
  await replaceText(page, content);
  await page.locator('#more-button').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-button').click();
  const download = await downloadPromise;
  const html = await readFile((await download.path())!, 'utf8');
  expect(html).toContain('最新草稿');
  expect(html).toContain('<strong>尚未保存的正文</strong>');
  expect(html).not.toContain('旧内容');
  await expect(page.locator('#save-state')).toContainText('未保存');
  await page.keyboard.press(`${mod}+Shift+m`);
  await expect(page.locator('#source-view')).toBeVisible();
  await expect(page.locator('#source-view')).toHaveText(content);
  await expect(page.locator('#save-state')).toContainText('未保存');
});

test('a dirty browser page warns before reload and cancellation keeps the draft', async ({ page }) => {
  await openDocuments(page, { name: '防丢失.md', content: '# 不要丢失' });
  await appendText(page, '\n\n未保存的草稿。');
  const dialogPromise = page.waitForEvent('dialog');
  await page.evaluate(() => { setTimeout(() => window.location.reload(), 0); });
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.dismiss();
  await expect(editor(page)).toContainText('未保存的草稿。');
  await expect(page.locator('#save-state')).toContainText('未保存');
});

test('source editing remains usable in a narrow window and returns to reading', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 740, height: 900 });
  await openDocuments(page, { name: '小窗口编辑.md', content: '# 小窗口\n\n正文。' });
  await replaceText(page, '# 小窗口编辑\n\n宽度可以变化，文字依然保留。');
  await expect(editor(page)).toBeInViewport();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
  const editorBox = await editor(page).boundingBox();
  expect(editorBox).not.toBeNull();
  expect(editorBox!.width).toBeGreaterThan(250);
  await captureScreenshot(page, testInfo, 'source-editor-narrow');
  await page.locator('#edit-button').click();
  await expect(page.locator('#article h1')).toHaveText('小窗口编辑');
});
