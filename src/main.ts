import './style.css';
import 'katex/dist/katex.min.css';
import { renderMarkdown } from './markdown';
import { icon } from './icons';
import { welcome } from './sample';
import { createMarkdownEditor } from './editor';
import { createRichEditor } from './rich-editor';
import { isNative, initPlatform, openDocuments, readDocument, documentFromFile, resolveImage, openExternal, printDocument, saveHtml, saveMarkdown, loadPreference, savePreference, type OpenDocument } from './platform';

type Preferences = { theme: 'light' | 'paper' | 'dark' | 'system'; fontSize: number; width: 'compact' | 'standard' | 'wide'; serif: boolean; sidebar: boolean };
type Recent = { name: string; path: string };
const defaults: Preferences = { theme: 'light', fontSize: 17, width: 'standard', serif: false, sidebar: true };
let prefs = { ...defaults };
let recent: Recent[] = [];
const docs: OpenDocument[] = [{ id: 'welcome', name: '欢迎使用.md', content: welcome }];
let active = docs[0];
let headings: ReturnType<typeof renderMarkdown>['headings'] = [];
let sourceMode = false;
let editing = false;
let sourceEditing = false;
let closingApp = false;
let previewTimer: ReturnType<typeof setTimeout>;
const savedContents = new Map<string, string>([['welcome', welcome]]);
const downloaded = new Set<string>();
const saving = new Map<OpenDocument, Promise<boolean>>();
let searchIndex = 0;
let marks: HTMLElement[][] = [];
let richMatchCount = 0;
let renderVersion = 0;
let toastTimer: ReturnType<typeof setTimeout>;
let observer: IntersectionObserver | undefined;
const positions = new Map<string, number>();
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const button = (id: string, name: string, label: string, extra = '') => `<button id="${id}" class="icon-button" aria-label="${label}" title="${label}" ${extra}>${icon(name)}</button>`;

$('#app').innerHTML = `
  <aside class="sidebar" id="sidebar" aria-label="文档导航">
    <div class="brand"><img src="./mark.svg" alt="" width="29" height="29"><span>留白</span><span class="brand-note">STILL</span></div>
    <button class="open-button" id="open-file">${icon('open')}<span>打开文件</span><kbd class="open-key">⌃ O</kbd></button>
    <div class="side-tabs" role="tablist" aria-label="导航类型"><button id="outline-tab" role="tab" aria-selected="true" aria-controls="outline-panel">目录</button><button id="files-tab" role="tab" aria-selected="false" aria-controls="files-panel">文件<span id="file-count">1</span></button></div>
    <div class="side-panel" id="outline-panel" role="tabpanel" aria-labelledby="outline-tab"><div class="outline-caption">当前文档</div><nav id="outline" aria-label="文章目录"></nav></div>
    <div class="side-panel" id="files-panel" role="tabpanel" aria-labelledby="files-tab" hidden><div class="outline-caption">已打开</div><div id="file-list"></div><div id="recent-list"></div></div>
    <div class="sidebar-bottom"><span class="local-dot"></span>本地书写，安静如初<span>1.2</span></div>
  </aside>
  <section class="workspace">
    <header class="toolbar"><div class="toolbar-left">${button('toggle-sidebar', 'panel', '切换侧栏', 'aria-expanded="true" aria-controls="sidebar"')}<span class="toolbar-separator"></span><span class="document-name" id="document-name">欢迎使用.md</span><span class="dirty-dot" id="title-dirty" aria-label="未保存" hidden></span></div><div class="toolbar-right">${button('new-button', 'plus', '新建文档')}<button id="edit-button" class="mode-button" aria-pressed="false" title="编辑 / 阅读（Ctrl / ⌘ E）">${icon('edit')}<span>编辑</span></button>${button('source-edit-button', 'code', '切换源码编辑', 'aria-pressed="false" hidden')}${button('save-button', 'save', '保存文档', 'hidden')}${button('find-button', 'search', '文内搜索')}<button id="appearance-button" class="icon-button type-button" aria-label="阅读设置" aria-expanded="false" aria-controls="appearance-panel" title="阅读设置">Aa</button>${button('more-button', 'more', '更多操作', 'aria-expanded="false" aria-controls="more-panel"')}</div></header>
    <div class="findbar" id="findbar" hidden><label for="search-input">${icon('search')}</label><input id="search-input" type="search" placeholder="在文中查找…" aria-label="搜索正文" autocomplete="off"><span id="search-count" aria-live="polite">0 / 0</span>${button('search-prev', 'up', '上一个结果')}${button('search-next', 'down', '下一个结果')}${button('search-close', 'close', '关闭搜索')}</div>
    <div class="editor-toolbar" id="format-toolbar" hidden><span class="editor-label" id="editor-mode-label">所见即所得</span><div class="format-actions"><button data-format="bold" aria-label="加粗" title="加粗（Ctrl / ⌘ B）"><b>B</b></button><button data-format="italic" aria-label="斜体" title="斜体（Ctrl / ⌘ I）"><i>I</i></button><button data-format="heading" aria-label="标题" title="标题">H</button><button data-format="link" aria-label="插入链接" title="链接（Ctrl / ⌘ K）">${icon('link', 15)}</button><button data-format="code" aria-label="行内代码" title="行内代码">${icon('code', 15)}</button><button data-format="list" aria-label="列表" title="列表">${icon('list', 15)}</button><button data-format="quote" data-rich-only aria-label="引用" title="引用">“</button><button data-format="task" data-rich-only aria-label="任务列表" title="任务列表">${icon('check', 15)}</button><button data-format="table" data-rich-only aria-label="插入表格" title="插入表格">${icon('table', 15)}</button><span class="format-divider"></span>${button('undo-button', 'undo', '撤销')}${button('redo-button', 'redo', '重做')}</div></div><div id="reading-area"><section id="editor-pane" hidden aria-label="源码编辑区"><div id="editor-host"></div></section><main id="reader" tabindex="0" aria-label="文档阅读区"><div class="document-shell"><div class="eyebrow" id="eyebrow"><span class="eyebrow-line"></span>开始阅读<span id="welcome-edition">A QUIET SPACE FOR WORDS</span></div><article id="article" class="prose"></article><div id="rich-host" hidden></div><pre id="source-view" hidden aria-label="Markdown 源文"></pre><div class="document-end"><span></span><img src="./mark.svg" width="25" height="25" alt="阅读完毕"><span></span></div></div></main></div>
    <footer class="statusbar"><div><span id="word-count">0 字</span><span class="status-dot">·</span><span id="reading-time">约 1 分钟</span></div><button id="back-top" title="回到开头"><span id="read-progress">0%</span><span class="progress-track"><span id="progress-fill"></span></span></button><div><span id="save-state" aria-live="polite">本地文档</span><span class="status-dot">·</span><span id="view-status">阅读模式</span></div></footer>
  </section>
  <section id="appearance-panel" class="popover appearance-panel" aria-label="阅读设置" hidden><div class="popover-heading">阅读设置</div><label class="setting-label">外观</label><div class="theme-options"><button data-theme="light"><span class="theme-preview preview-light">Aa</span>明亮</button><button data-theme="paper"><span class="theme-preview preview-paper">Aa</span>纸色</button><button data-theme="dark"><span class="theme-preview preview-dark">Aa</span>深色</button></div><button class="system-option" id="system-theme">跟随系统<span id="system-check"></span></button><div class="setting-row"><span>字号</span><div class="stepper">${button('font-minus', 'minus', '缩小字号')}<output id="font-size">17</output>${button('font-plus', 'plus', '放大字号')}</div></div><div class="setting-row"><span>字体</span><div class="segmented"><button data-font="sans">现代</button><button data-font="serif">宋体</button></div></div><div class="setting-row"><span>版心</span><div class="segmented"><button data-width="compact">窄</button><button data-width="standard">中</button><button data-width="wide">宽</button></div></div><button id="reset-appearance" class="text-button">恢复默认</button></section>
  <section id="more-panel" class="popover more-panel" aria-label="更多操作" hidden><button id="save-as-button">${icon('save')}<span>另存为 Markdown</span><kbd>⇧ ⌘ S</kbd></button><div class="menu-divider"></div><button id="source-button">${icon('code')}<span>查看源文</span><kbd>⌘ ⇧ M</kbd></button><button id="refresh-button">${icon('refresh')}<span>重新读取文件</span></button><div class="menu-divider"></div><button id="export-button">${icon('export')}<span>导出 HTML</span></button><button id="print-button">${icon('print')}<span>打印 / 存为 PDF</span></button><div class="menu-divider"></div><button id="help-button">${icon('file')}<span>使用指南</span></button></section>
  <dialog id="unsaved-dialog" aria-labelledby="dialog-title" aria-describedby="dialog-message"><h2 id="dialog-title">保存修改？</h2><p id="dialog-message"></p><div class="dialog-actions"><button data-decision="discard">不保存</button><span></span><button data-decision="cancel" autofocus>取消</button><button class="primary" data-decision="save">保存</button></div></dialog>
  <div class="drop-overlay" id="drop-overlay" hidden><div>${icon('open', 38)}<h2>把文字，放在这里。</h2><p>松开以阅读 Markdown 文件</p><span>.md &nbsp; .markdown &nbsp; .txt</span></div></div>
  <div class="toast" id="toast" role="status" hidden></div>
`;

const reader = $('#reader');
const article = $('#article');
const searchInput = $<HTMLInputElement>('#search-input');
const isMac = /Mac|iPhone|iPad/i.test(navigator.platform);
$('.open-key').textContent = isMac ? '⌘ O' : 'Ctrl O';
$('#source-button kbd').textContent = isMac ? '⌘ ⇧ M' : 'Ctrl ⇧ M';
$('#save-as-button kbd').textContent = isMac ? '⌘ ⇧ S' : 'Ctrl ⇧ S';
function onEditorChange(content: string) {
    active.content = content;
    updateDirtyState();
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => { void showDocument(active, true); }, 180);
}
const editor = createMarkdownEditor($('#editor-host'), {
  onChange: onEditorChange,
  onSave: () => { void saveDocument(active); },
});
const richEditor = createRichEditor($('#rich-host'), {
  onChange: onEditorChange,
  onSave: () => { void saveDocument(active); },
  resolveImage: (src: string) => resolveImage(src, active.path),
});
function currentEditor() { return sourceEditing ? editor : richEditor; }
function syncEditors(doc: OpenDocument) {
  editor.setDocument(doc.id, doc.content);
  richEditor.setDocument(doc.id, doc.content);
  richEditor.setImageResolver((src: string) => resolveImage(src, active.path));
}

function isDirty(doc: OpenDocument) { return doc.content !== (savedContents.get(doc.id) ?? ''); }
function updateDirtyState() {
  const dirty = isDirty(active);
  $('#title-dirty').hidden = !dirty;
  document.title = `${dirty ? '● ' : ''}${active.name} — 留白`;
  $('#save-state').textContent = saving.has(active) ? '保存中…' : dirty ? '未保存' : downloaded.has(active.id) ? '已下载' : active.path ? '已保存' : active.id.startsWith('new:') ? '尚未保存' : '本地文档';
  $('#save-state').classList.toggle('unsaved', dirty);
  $<HTMLButtonElement>('#save-button').disabled = saving.has(active) || Boolean(active.path && !dirty);
  document.querySelectorAll<HTMLElement>('[data-document]').forEach(element => {
    const doc = docs.find(d => d.id === element.dataset.document);
    element.classList.toggle('document-dirty', Boolean(doc && isDirty(doc)));
  });
}

type Decision = 'save' | 'discard' | 'cancel';
function askDecision(title: string, message: string, labels = { save: '保存', discard: '不保存', cancel: '取消' }): Promise<Decision> {
  const dialog = $<HTMLDialogElement>('#unsaved-dialog');
  if (dialog.open) return Promise.resolve('cancel');
  const previousFocus = document.activeElement as HTMLElement | null;
  $('#dialog-title').textContent = title;
  $('#dialog-message').textContent = message;
  for (const decision of ['save', 'discard', 'cancel'] as const) $(`[data-decision="${decision}"]`).textContent = labels[decision];
  return new Promise(resolve => {
    const finish = (decision: Decision) => { dialog.removeEventListener('click', click); dialog.removeEventListener('cancel', cancel); dialog.close(); previousFocus?.focus(); resolve(decision); };
    const click = (event: MouseEvent) => { const decision = (event.target as HTMLElement).closest<HTMLElement>('[data-decision]')?.dataset.decision; if (decision) finish(decision as Decision); };
    const cancel = (event: Event) => { event.preventDefault(); finish('cancel'); };
    dialog.addEventListener('click', click);
    dialog.addEventListener('cancel', cancel);
    dialog.showModal();
    $('[data-decision="cancel"]').focus();
  });
}

async function saveDocument(doc: OpenDocument, saveAs = false): Promise<boolean> {
  closePopovers();
  if (doc.id === 'welcome') {
    const copy = { id: `new:${crypto.randomUUID()}`, name: '欢迎使用-副本.md', content: doc.content };
    savedContents.set(copy.id, '');
    docs.push(copy);
    await showDocument(copy);
    return saveDocument(copy, true);
  }
  const running = saving.get(doc);
  if (running) return running;
  const snapshot = doc.content;
  const oldId = doc.id;
  const oldPath = doc.path;
  const task = (async () => {
    try {
      const beforeWrite = (path: string) => {
        const normalize = (value: string) => { const normalized = value.replaceAll('\\', '/'); return isMac ? normalized : normalized.toLowerCase(); };
        if (docs.some(other => other !== doc && other.path && normalize(other.path) === normalize(path))) {
          toast('该文件已在另一个标签中打开，请切换到该文档，或选择其他保存位置。');
          return false;
        }
        return true;
      };
      const options = { saveAs, expectedContent: savedContents.get(oldId), beforeWrite };
      let result: OpenDocument | null;
      try { result = await saveMarkdown({ ...doc, content: snapshot }, options); }
      catch (error) {
        if ((error as { code?: string })?.code !== 'FILE_CHANGED') throw error;
        const decision = await askDecision('文件在别处发生了变化', `「${doc.name}」的磁盘内容与打开时不同。你可以另存为新文件，或确认用当前内容覆盖。`, { save: '另存为', discard: '覆盖磁盘文件', cancel: '取消' });
        if (decision === 'cancel') return false;
        result = await saveMarkdown({ ...doc, content: snapshot }, { ...options, saveAs: decision === 'save', force: decision === 'discard' });
      }
      if (!result) return false;
      doc.id = result.id; doc.name = result.name; doc.path = result.path;
      savedContents.delete(oldId);
      savedContents.set(doc.id, snapshot);
      editor.renameDocument(oldId, doc.id);
      richEditor.renameDocument(oldId, doc.id);
      if (positions.has(oldId)) { const position = positions.get(oldId)!; positions.delete(oldId); positions.set(doc.id, position); }
      downloaded.delete(oldId);
      if (!isNative) downloaded.add(doc.id);
      if (doc.path) { recent = [{ name: doc.name, path: doc.path }, ...recent.filter(r => r.path !== doc.path)].slice(0, 10); await savePreference('recent', recent).catch(() => {}); }
      if (doc === active) {
        $('#document-name').textContent = doc.name;
        $('#document-name').title = doc.path || doc.name;
        $<HTMLButtonElement>('#refresh-button').disabled = !doc.path;
        if (oldPath !== doc.path) { richEditor.setImageResolver((src: string) => resolveImage(src, active.path)); await showDocument(doc, true); }
      }
      renderNavigation();
      toast(isNative ? '已保存' : 'Markdown 已下载');
      return !isDirty(doc);
    } catch (error) { toast(error instanceof Error ? error.message : '保存失败，修改仍保留在编辑器中。'); return false; }
    finally { saving.delete(doc); updateDirtyState(); }
  })();
  saving.set(doc, task);
  updateDirtyState();
  return task;
}

async function resolveUnsaved(doc: OpenDocument): Promise<Decision> {
  if (saving.has(doc)) await saving.get(doc);
  if (!isDirty(doc)) return 'discard';
  const decision = await askDecision('保存修改？', `「${doc.name}」有尚未保存的修改。不保存将丢失这些修改。`);
  if (decision === 'save' && !(await saveDocument(doc))) return 'cancel';
  return decision;
}

function setClosing(value: boolean) {
  closingApp = value;
  $('.workspace').inert = value;
  $('#sidebar').inert = value;
}
async function canCloseApp() {
  setClosing(true);
  let approved = false;
  const discarded = new Map<OpenDocument, string>();
  try {
    for (;;) {
      for (const doc of [...docs]) {
        if (discarded.get(doc) === doc.content) continue;
        const decision = await resolveUnsaved(doc);
        if (decision === 'cancel') return false;
        if (decision === 'discard' && isDirty(doc)) discarded.set(doc, doc.content);
      }
      if (docs.every(doc => !isDirty(doc) || discarded.get(doc) === doc.content) && saving.size === 0) { approved = true; return true; }
    }
  } finally { if (!approved) setClosing(false); }
}

async function newDocument(copy?: string) {
  if (closingApp) return;
  closePopovers();
  let number = 1;
  let name = copy ? '欢迎使用-副本.md' : '未命名.md';
  while (docs.some(doc => doc.name === name)) name = `${copy ? '欢迎使用-副本' : '未命名'} ${++number}.md`;
  const doc = { id: `new:${crypto.randomUUID()}`, name, content: copy || '' };
  savedContents.set(doc.id, '');
  docs.push(doc);
  editing = true; sourceMode = false; sourceEditing = false;
  await showDocument(doc);
  richEditor.focus();
}

async function toggleEditing() {
  closePopovers();
  if (!editing && active.id === 'welcome') { await newDocument(welcome); return; }
  editing = !editing; sourceMode = false;
  if (editing) sourceEditing = false;
  $('#findbar').hidden = true;
  clearTimeout(previewTimer);
  await showDocument(active);
  if (editing) currentEditor().focus(); else reader.focus();
}

function toggleSourceEditing() {
  sourceEditing = !sourceEditing;
  if (sourceEditing) { $('#findbar').hidden = true; clearSearchMarks(); }
  syncEditors(active);
  updateSourceView();
  currentEditor().focus();
}

function updateEditorLayout() {
  $('#app').classList.toggle('editing', editing);
  $('#app').classList.toggle('source-editing', editing && sourceEditing);
  $('#editor-pane').hidden = !editing || !sourceEditing;
  reader.hidden = editing && sourceEditing;
  $('#rich-host').hidden = !editing || sourceEditing;
  $('#format-toolbar').hidden = !editing;
  $('#source-edit-button').hidden = !editing;
  $('#source-edit-button').setAttribute('aria-pressed', String(sourceEditing));
  $('#source-edit-button').setAttribute('aria-label', sourceEditing ? '切换可视编辑' : '切换源码编辑');
  $('#source-edit-button').title = sourceEditing ? '切换可视编辑' : '切换源码编辑';
  $('#editor-mode-label').textContent = sourceEditing ? 'MARKDOWN' : '所见即所得';
  document.querySelectorAll<HTMLElement>('[data-rich-only]').forEach(element => element.hidden = sourceEditing);
  $('#save-button').hidden = !editing && !isDirty(active);
  $('#edit-button').setAttribute('aria-pressed', String(editing));
  $('#edit-button span').textContent = editing ? '阅读' : '编辑';
  updateDirtyState();
}

function toast(message: string) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => $('#toast').hidden = true, 4200);
}
function closePopovers() {
  for (const name of ['appearance', 'more']) {
    $(`#${name}-panel`).hidden = true;
    $(`#${name}-button`).setAttribute('aria-expanded', 'false');
  }
}
function togglePopover(name: string) {
  const wasOpen = !$(`#${name}-panel`).hidden;
  closePopovers();
  $(`#${name}-panel`).hidden = wasOpen;
  $(`#${name}-button`).setAttribute('aria-expanded', String(!wasOpen));
}
function applyPreferences(save = true) {
  const theme = prefs.theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : prefs.theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.width = prefs.width;
  document.documentElement.dataset.font = prefs.serif ? 'serif' : 'sans';
  document.documentElement.style.setProperty('--reading-size', `${prefs.fontSize}px`);
  $('#app').classList.toggle('sidebar-hidden', !prefs.sidebar);
  $('#toggle-sidebar').setAttribute('aria-expanded', String(prefs.sidebar));
  $('#font-size').textContent = `${prefs.fontSize}`;
  $<HTMLButtonElement>('#font-minus').disabled = prefs.fontSize <= 14;
  $<HTMLButtonElement>('#font-plus').disabled = prefs.fontSize >= 24;
  document.querySelectorAll<HTMLElement>('[data-theme]').forEach(e => { if (e.tagName === 'BUTTON') { e.classList.toggle('selected', e.dataset.theme === prefs.theme); e.setAttribute('aria-pressed', String(e.dataset.theme === prefs.theme)); } });
  document.querySelectorAll<HTMLElement>('[data-width]').forEach(e => { if (e.tagName === 'BUTTON') { e.classList.toggle('selected', e.dataset.width === prefs.width); e.setAttribute('aria-pressed', String(e.dataset.width === prefs.width)); } });
  document.querySelectorAll<HTMLElement>('button[data-font]').forEach(e => { const selected = (e.dataset.font === 'serif') === prefs.serif; e.classList.toggle('selected', selected); e.setAttribute('aria-pressed', String(selected)); });
  $('#system-check').innerHTML = prefs.theme === 'system' ? icon('check', 14) : '';
  $('#system-theme').setAttribute('aria-pressed', String(prefs.theme === 'system'));
  if (save) void savePreference('preferences', prefs).catch(() => toast('设置暂时无法保存，仍可继续阅读。'));
}

function renderNavigation() {
  $('#file-count').textContent = String(docs.length);
  $('#file-list').innerHTML = docs.map(d => `<div class="file-row"><button class="file-item ${d.id === active.id ? 'active' : ''}" data-document="${escape(d.id)}" title="${escape(d.path || d.name)}">${icon('file', 16)}<span>${escape(d.name)}</span></button>${d.id !== 'welcome' ? `<button class="close-file" data-close-document="${escape(d.id)}" aria-label="关闭 ${escape(d.name)}" title="关闭文件">${icon('close', 13)}</button>` : ''}</div>`).join('');
  $('#recent-list').innerHTML = recent.length ? `<div class="outline-caption recent-caption">最近阅读<button id="clear-recent" title="清除最近记录">清除</button></div>${recent.map(d => `<button class="file-item recent-item" data-recent="${escape(d.path)}" title="${escape(d.path)}">${icon('file', 16)}<span>${escape(d.name)}</span></button>`).join('')}` : '';
  $('#clear-recent')?.addEventListener('click', () => { recent = []; void savePreference('recent', recent); renderNavigation(); });
  updateDirtyState();
}

async function showDocument(doc: OpenDocument, live = false) {
  clearTimeout(previewTimer);
  positions.set(active.id, reader.scrollTop);
  active = doc;
  if (doc.id === 'welcome') editing = false;
  if (!savedContents.has(doc.id)) savedContents.set(doc.id, doc.content);
  if (!live) syncEditors(doc);
  const version = ++renderVersion;
  observer?.disconnect();
  const rendered = renderMarkdown(doc.content);
  headings = rendered.headings;
  article.innerHTML = rendered.html || '<p class="empty-document">这份文档还是空白的。</p>';
  $('#source-view').textContent = doc.content;
  $('#document-name').textContent = doc.name;
  $('#document-name').title = doc.path || doc.name;
  document.title = `${doc.name} — 留白`;
  $('#eyebrow').innerHTML = doc.id === 'welcome' ? '<span class="eyebrow-line"></span>开始阅读<span id="welcome-edition">A QUIET SPACE FOR WORDS</span>' : `<span class="eyebrow-line"></span>本地文档<span>${escape(doc.name.split('.').pop()?.toUpperCase() || 'MD')}</span>`;
  $('#word-count').textContent = `${rendered.wordCount.toLocaleString()} 字`;
  $('#reading-time').textContent = `约 ${rendered.readingMinutes} 分钟`;
  $('#outline').innerHTML = headings.length ? headings.map(h => `<button data-heading="${escape(h.id)}" class="outline-item level-${h.level}" style="--level:${Math.min(h.level - 1, 3)}" title="${escape(h.text || '无标题章节')}">${escape(h.text || '无标题章节')}</button>`).join('') : '<p class="empty-outline">还没有章节标题<br><span>静静读，也很好。</span></p>';
  renderNavigation();
  if (!live) reader.scrollTop = positions.get(doc.id) || 0;
  updateSourceView();
  updateSearch();
  updateProgress();
  $<HTMLButtonElement>('#refresh-button').disabled = !doc.path;
  observer = new IntersectionObserver(() => updateOutline(), { root: reader, rootMargin: '-5% 0px -65% 0px', threshold: 0 });
  article.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(el => observer!.observe(el));
  updateOutline();
  await Promise.all(Array.from(article.querySelectorAll<HTMLImageElement>('img')).map(async img => {
    const src = img.getAttribute('src') || img.dataset.localSrc || '';
    if (/^https:\/\//i.test(src)) { img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; return; }
    try {
      const resolved = await resolveImage(src, doc.path);
      if (version !== renderVersion) return;
      if (resolved) img.src = resolved;
      else { img.removeAttribute('src'); img.classList.add('unavailable-image'); img.alt = `${img.alt || '本地图片'}（请在桌面版中打开原文件以查看）`; }
    } catch { img.removeAttribute('src'); img.alt = `${img.alt || '图片'}（暂时无法读取）`; }
  }));
}

async function addDocuments(incoming: OpenDocument[]) {
  if (!incoming.length || closingApp) return;
  let lastOpened: OpenDocument | undefined;
  for (let doc of incoming) {
    const existing = docs.find(item => item.id === doc.id);
    if (existing) {
      const wasSaving = saving.has(existing);
      if (isDirty(existing) || saving.has(existing)) {
        const decision = await resolveUnsaved(existing);
        if (decision === 'cancel') continue;
        if (decision === 'save' || (wasSaving && !isDirty(existing))) doc = existing;
        else if (existing.path) doc = await readDocument(existing.path);
      }
      if (closingApp) return;
      if (docs.includes(existing)) {
        Object.assign(existing, doc);
        doc = existing;
        if (active === existing) syncEditors(doc);
      } else docs.push(doc);
    } else docs.push(doc);
    savedContents.set(doc.id, doc.content);
    lastOpened = doc;
    if (doc.path) recent = [{ name: doc.name, path: doc.path }, ...recent.filter(r => r.path !== doc.path)].slice(0, 10);
  }
  if (!lastOpened) return;
  void savePreference('recent', recent).catch(() => {});
  await showDocument(lastOpened);
  if (innerWidth < 800) { prefs.sidebar = false; applyPreferences(); }
}
async function openFiles() {
  closePopovers();
  try { await addDocuments(await openDocuments()); } catch (e) { toast(e instanceof Error ? e.message : '无法打开文件，请重试。'); }
}
function setTab(tab: 'outline' | 'files') {
  for (const name of ['outline', 'files']) {
    $(`#${name}-tab`).setAttribute('aria-selected', String(tab === name));
    $(`#${name}-panel`).hidden = tab !== name;
  }
}
function updateOutline() {
  const top = reader.getBoundingClientRect().top + 90;
  let current: string | undefined = headings[0]?.id;
  const scope = editing && !sourceEditing ? $('#rich-host') : article;
  for (const h of headings) { if (scope.querySelector(`[id="${CSS.escape(h.id)}"],[data-heading-id="${CSS.escape(h.id)}"]`)?.getBoundingClientRect().top! <= top) current = h.id; }
  if (reader.scrollHeight > reader.clientHeight && reader.scrollTop + reader.clientHeight >= reader.scrollHeight - 3) current = headings.at(-1)?.id;
  document.querySelectorAll<HTMLElement>('[data-heading]').forEach(e => { const selected = e.dataset.heading === current; e.classList.toggle('active', selected); if (selected) e.setAttribute('aria-current', 'location'); else e.removeAttribute('aria-current'); });
}
function updateProgress() {
  const max = reader.scrollHeight - reader.clientHeight;
  const value = max > 0 ? Math.round(reader.scrollTop / max * 100) : 100;
  $('#read-progress').textContent = `${Math.max(0, Math.min(100, value))}%`;
  $('#progress-fill').style.width = `${value}%`;
}
function clearSearchMarks() {
  richEditor.find('', 0);
  richMatchCount = 0;
  article.querySelectorAll('mark.search-result').forEach(el => el.replaceWith(document.createTextNode(el.textContent || '')));
  article.normalize();
  marks = [];
}
function updateSearch() {
  clearSearchMarks();
  const query = searchInput.value.trim().toLocaleLowerCase();
  if (editing && !sourceEditing) {
    searchIndex = 0;
    richMatchCount = !$('#findbar').hidden ? richEditor.find(query, searchIndex) : 0;
    updateSearchCount(richMatchCount);
    return;
  }
  if (query && !$('#findbar').hidden && !sourceMode) {
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, { acceptNode: node => node.parentElement?.closest('button,.katex,.code-language') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const blocks = new Map<Element, Text[]>();
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const block = node.parentElement!.closest('p,li,h1,h2,h3,h4,h5,h6,td,th,pre,blockquote') || article;
      if (!blocks.has(block)) blocks.set(block, []);
      blocks.get(block)!.push(node);
    }
    for (const nodes of blocks.values()) {
      const combined = nodes.map(n => n.data).join('').toLocaleLowerCase();
      const matches: { start: number; end: number; group: HTMLElement[] }[] = [];
      let found = combined.indexOf(query);
      while (found >= 0 && marks.length < 5000) {
        const group: HTMLElement[] = []; marks.push(group);
        matches.push({ start: found, end: found + query.length, group });
        found = combined.indexOf(query, found + query.length);
      }
      let offset = 0;
      for (const node of nodes) {
        const raw = node.data;
        const overlaps = matches.filter(match => match.start < offset + raw.length && match.end > offset);
        if (overlaps.length) {
          const fragment = document.createDocumentFragment();
          let start = 0;
          for (const match of overlaps) {
            const from = Math.max(0, match.start - offset), to = Math.min(raw.length, match.end - offset);
            fragment.append(raw.slice(start, from));
            const mark = document.createElement('mark'); mark.className = 'search-result'; mark.textContent = raw.slice(from, to); fragment.append(mark); match.group.push(mark);
            start = to;
          }
          fragment.append(raw.slice(start)); node.replaceWith(fragment);
        }
        offset += raw.length;
      }
    }
  }
  searchIndex = 0;
  selectSearchResult(false);
}
function selectSearchResult(scroll = true) {
  if (editing && !sourceEditing) {
    richMatchCount = richEditor.find(searchInput.value.trim(), searchIndex);
    updateSearchCount(richMatchCount);
    return;
  }
  marks.forEach((group, index) => group.forEach(m => m.classList.toggle('current', index === searchIndex)));
  updateSearchCount(marks.length);
  if (scroll) marks[searchIndex]?.[0]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
function updateSearchCount(count: number) {
  $('#search-count').textContent = `${count ? searchIndex + 1 : 0} / ${count}${count >= 5000 ? '+' : ''}`;
  $<HTMLButtonElement>('#search-prev').disabled = !count;
  $<HTMLButtonElement>('#search-next').disabled = !count;
}
function stepSearch(direction: number) { const count = editing && !sourceEditing ? richMatchCount : marks.length; if (count) { searchIndex = (searchIndex + direction + count) % count; selectSearchResult(); } }
function toggleFind(show: boolean) {
  closePopovers();
  $('#findbar').hidden = !show;
  if (show) { if (editing && sourceEditing) toggleSourceEditing(); if (sourceMode) sourceMode = false; updateSourceView(); searchInput.focus(); searchInput.select(); } else { clearSearchMarks(); if (editing) richEditor.focus(); else reader.focus(); }
  updateSearch();
}
function updateSourceView() {
  article.hidden = sourceMode || editing;
  $('#source-view').hidden = !sourceMode;
  $('#view-status').textContent = sourceMode ? '源文 · 只读' : editing ? sourceEditing ? '源码编辑' : '所见即所得' : '阅读模式';
  $('#source-button span').textContent = sourceMode ? '返回阅读' : '查看源文';
  updateEditorLayout();
}
function toggleSource() {
  editing = false;
  sourceMode = !sourceMode;
  closePopovers();
  if (sourceMode) toggleFind(false);
  updateSourceView();
  $('#source-view').textContent = active.content;
  reader.scrollTop = 0;
  updateProgress();
}
async function exportDocument() {
  closePopovers();
  const exporting = { ...active };
  const clone = document.createElement('article');
  clone.innerHTML = renderMarkdown(exporting.content).html;
  await Promise.all(Array.from(clone.querySelectorAll<HTMLImageElement>('img')).map(async img => {
    const src = img.getAttribute('src') || img.dataset.localSrc || '';
    if (/^https:\/\//i.test(src)) return;
    const image = await resolveImage(src, exporting.path).catch(() => null);
    if (image) img.src = image; else img.removeAttribute('src');
  }));
  clone.querySelectorAll('button,.code-toolbar').forEach(el => el.remove());
  clone.querySelectorAll('mark.search-result').forEach(el => el.replaceWith(document.createTextNode(el.textContent || '')));
  clone.querySelectorAll('a').forEach(a => { if (a.getAttribute('href')?.startsWith('#')) return; if (!/^https?:\/\//i.test(a.href) && !/^mailto:/i.test(a.href)) a.removeAttribute('href'); });
  const styles = (await Promise.all(Array.from(document.styleSheets).map(async sheet => {
    try {
      return (await Promise.all(Array.from(sheet.cssRules).map(async rule => {
        if (rule instanceof CSSFontFaceRule) {
          const source = rule.style.getPropertyValue('src').match(/url\(["']?([^"')]+\.woff2)["']?\)/)?.[1];
          if (source) {
            const response = await fetch(new URL(source, sheet.href || location.href));
            if (!response.ok) throw new Error('Font unavailable');
            const bytes = new Uint8Array(await response.arrayBuffer());
            let raw = ''; for (let i = 0; i < bytes.length; i += 8192) raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
            return rule.cssText.replace(/src:[^;]+;/, `src:url(data:font/woff2;base64,${btoa(raw)}) format('woff2');`);
          }
        }
        return rule.cssText;
      }))).join('\n');
    } catch { return ''; }
  }))).join('\n');
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; font-src data:"><title>${escape(exporting.name)}</title><style>${styles}\nhtml,body{overflow:auto;height:auto;background:#fff;color:#30312e}body{padding:56px 24px}article.prose{max-width:760px;margin:auto;font-size:17px} .prose [hidden]{display:none!important}</style><body><article class="prose">${clone.innerHTML}</article></body></html>`;
  try { await saveHtml(exporting.name.replace(/\.[^.]+$/, '') + '.html', html); } catch (error) { toast(error instanceof Error ? error.message : '导出未完成，请重试。'); }
}

$('#open-file').addEventListener('click', openFiles);
$('#new-button').addEventListener('click', () => { void newDocument(); });
$('#edit-button').addEventListener('click', () => { void toggleEditing(); });
$('#source-edit-button').addEventListener('click', toggleSourceEditing);
$('#save-button').addEventListener('click', () => { void saveDocument(active); });
$('#save-as-button').addEventListener('click', () => { void saveDocument(active, true); });
$('.format-actions').addEventListener('mousedown', e => e.preventDefault());
$('.format-actions').addEventListener('click', e => { const button = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!button) return; if (button.dataset.format) { if (sourceEditing) editor.insertFormat(button.dataset.format as Parameters<typeof editor.insertFormat>[0]); else richEditor.insertFormat(button.dataset.format as Parameters<typeof richEditor.insertFormat>[0]); } if (button.id === 'undo-button') currentEditor().undo(); if (button.id === 'redo-button') currentEditor().redo(); if (sourceEditing || button.dataset.format !== 'link') currentEditor().focus(); });
$('#toggle-sidebar').addEventListener('click', () => { prefs.sidebar = !prefs.sidebar; applyPreferences(); });
$('#outline-tab').addEventListener('click', () => setTab('outline'));
$('#files-tab').addEventListener('click', () => setTab('files'));
$('.side-tabs').addEventListener('keydown', event => { const e = event as KeyboardEvent; if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { const tab = $('#outline-tab').getAttribute('aria-selected') === 'true' ? 'files' : 'outline'; setTab(tab); $(`#${tab}-tab`).focus(); e.preventDefault(); } });
$('#sidebar').addEventListener('click', async event => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('button');
  if (!target) return;
  if (target.dataset.heading) { if (sourceMode) sourceMode = false; if (editing && sourceEditing) toggleSourceEditing(); updateSourceView(); if (editing) richEditor.scrollToHeading(target.dataset.heading); else article.querySelector(`[id="${CSS.escape(target.dataset.heading)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  if (target.dataset.document) { const doc = docs.find(d => d.id === target.dataset.document); if (doc) await showDocument(doc); }
  if (target.dataset.closeDocument) {
    const closing = docs.find(d => d.id === target.dataset.closeDocument);
    if (closing && closing.id !== 'welcome' && await resolveUnsaved(closing) !== 'cancel') {
      const index = docs.indexOf(closing);
      if (index > 0) { const [removed] = docs.splice(index, 1); positions.delete(removed.id); savedContents.delete(removed.id); editor.forgetDocument(removed.id); richEditor.forgetDocument(removed.id); if (active === removed) { if (docs[Math.max(0, index - 1)].id === 'welcome') editing = false; await showDocument(docs[Math.max(0, index - 1)]); } else renderNavigation(); }
    }
  }
  if (target.dataset.recent) { try { await addDocuments([await readDocument(target.dataset.recent)]); } catch { toast('文件可能已移动或删除，请重新打开。'); } }
});
$('#appearance-button').addEventListener('click', () => togglePopover('appearance'));
$('#more-button').addEventListener('click', () => togglePopover('more'));
$('#appearance-panel').addEventListener('click', event => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('button');
  if (!target) return;
  if (target.dataset.theme) prefs.theme = target.dataset.theme as Preferences['theme'];
  if (target.dataset.width) prefs.width = target.dataset.width as Preferences['width'];
  if (target.dataset.font) prefs.serif = target.dataset.font === 'serif';
  if (target.id === 'font-minus') prefs.fontSize = Math.max(14, prefs.fontSize - 1);
  if (target.id === 'font-plus') prefs.fontSize = Math.min(24, prefs.fontSize + 1);
  if (target.id === 'system-theme') prefs.theme = 'system';
  if (target.id === 'reset-appearance') prefs = { ...defaults, sidebar: prefs.sidebar };
  applyPreferences();
});
$('#find-button').addEventListener('click', () => toggleFind(Boolean($('#findbar').hidden)));
$('#search-close').addEventListener('click', () => toggleFind(false));
$('#search-prev').addEventListener('click', () => stepSearch(-1));
$('#search-next').addEventListener('click', () => stepSearch(1));
searchInput.addEventListener('input', updateSearch);
searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); stepSearch(e.shiftKey ? -1 : 1); } });
$('#source-button').addEventListener('click', toggleSource);
$('#export-button').addEventListener('click', exportDocument);
$('#print-button').addEventListener('click', async () => { closePopovers(); sourceMode = false; editing = false; updateSourceView(); await showDocument(active, true); try { await printDocument(); } catch { toast('无法打开打印窗口。'); } });
$('#refresh-button').addEventListener('click', async () => { closePopovers(); const doc = active; if (doc.path) try { if (await resolveUnsaved(doc) === 'cancel') return; const refreshed = await readDocument(doc.path!); const index = docs.indexOf(doc); if (index >= 0) docs[index] = refreshed; savedContents.set(refreshed.id, refreshed.content); await showDocument(refreshed); toast('已重新读取文件'); } catch { toast('无法读取文件，请确认文件仍在原位置。修改仍保留在编辑器中。'); } });
$('#help-button').addEventListener('click', () => { closePopovers(); editing = false; sourceMode = false; void showDocument(docs[0]); });
$('#back-top').addEventListener('click', () => reader.scrollTo({ top: 0, behavior: 'smooth' }));
reader.addEventListener('scroll', () => { updateProgress(); updateOutline(); }, { passive: true });
new ResizeObserver(updateProgress).observe(reader);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (prefs.theme === 'system') applyPreferences(false); });
document.addEventListener('click', event => { if (!(event.target as HTMLElement).closest('.popover,#appearance-button,#more-button')) closePopovers(); });
document.addEventListener('keydown', e => {
  if (e.defaultPrevented || closingApp || $<HTMLDialogElement>('#unsaved-dialog').open) return;
  if (e.key === 'Escape') { const openPopover = !$('#appearance-panel').hidden ? 'appearance' : !$('#more-panel').hidden ? 'more' : null; closePopovers(); $('#drop-overlay').hidden = true; if (!$('#findbar').hidden) toggleFind(false); if (openPopover) $(`#${openPopover}-button`).focus(); }
  if (!e.ctrlKey && !e.metaKey) return;
  const key = e.key.toLowerCase();
  if (key === 's') { e.preventDefault(); void saveDocument(active, e.shiftKey); }
  if (key === 'n') { e.preventDefault(); void newDocument(); }
  if (key === 'e') { e.preventDefault(); void toggleEditing(); }
  if (key === 'o') { e.preventDefault(); void openFiles(); }
  if (key === 'f') { e.preventDefault(); toggleFind(true); }
  if (key === '\\') { e.preventDefault(); prefs.sidebar = !prefs.sidebar; applyPreferences(); }
  if (key === 'm' && e.shiftKey) { e.preventDefault(); toggleSource(); }
  if (key === 'p') { e.preventDefault(); $('#print-button').click(); }
});
window.addEventListener('beforeunload', event => { if (!isNative && docs.some(isDirty)) { event.preventDefault(); event.returnValue = ''; } });
article.addEventListener('click', async e => {
  const target = e.target as HTMLElement;
  const copyButton = target.closest<HTMLButtonElement>('[data-copy-code]');
  if (copyButton) {
    const code = copyButton.closest('.code-block')?.querySelector('code')?.textContent || copyButton.closest('pre')?.querySelector('code')?.textContent || '';
    try { await navigator.clipboard.writeText(code); toast('代码已复制'); } catch { toast('复制失败，请在源文中选择并复制。'); }
    return;
  }
  const link = target.closest('a');
  if (!link) return;
  const href = link.getAttribute('href') || '';
  e.preventDefault();
  if (href.startsWith('#')) { try { document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ behavior: 'smooth' }); } catch { /* malformed anchor */ } return; }
  if (/^(https?:|mailto:)/i.test(href)) { try { await openExternal(href); } catch { toast('暂时无法打开链接。'); } return; }
  if (active.path && /\.(md|markdown|txt)(#.*)?$/i.test(href) && !/^\w+:/i.test(href)) {
    try {
      const encodedPath = active.path.replace(/\\/g, '/').replace(/^\//, '').split('/').map(encodeURIComponent).join('/');
      const file = new URL(href, `file:///${encodedPath}`);
      const path = decodeURIComponent(file.pathname).replace(/^\/(?=[a-z]:)/i, '');
      await addDocuments([await readDocument(path)]);
      if (file.hash) {
        const anchor = decodeURIComponent(file.hash.slice(1));
        const slug = anchor.normalize('NFKC').toLowerCase().trim().replace(/[^\p{Letter}\p{Number}\p{Mark}\s_-]/gu, '').replace(/[\s_]+/gu, '-').replace(/^-+|-+$/gu, '');
        (document.getElementById(anchor) || document.getElementById(`heading-${slug}`))?.scrollIntoView();
      }
    } catch { toast('无法读取链接中的文件。'); }
  } else toast('这个链接暂时无法打开。');
});

let dragDepth = 0;
document.addEventListener('dragenter', e => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); dragDepth++; $('#drop-overlay').hidden = false; } });
document.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
document.addEventListener('dragleave', e => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; $('#drop-overlay').hidden = true; } });
document.addEventListener('drop', async e => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  e.preventDefault(); dragDepth = 0; $('#drop-overlay').hidden = true;
  if (isNative) return;
  const files = Array.from(e.dataTransfer?.files || []);
  try { await addDocuments(await Promise.all(files.map(documentFromFile))); } catch (error) { toast(error instanceof Error ? error.message : '请拖入 Markdown 文件。'); }
});

async function boot() {
  await initPlatform({ onFiles: async (opened) => { $('#drop-overlay').hidden = true; await addDocuments(opened); }, onError: message => { if (closingApp) setClosing(false); toast(message); }, onClose: canCloseApp });
  const stored = await loadPreference<Preferences>('preferences', defaults);
  prefs = { theme: ['light', 'paper', 'dark', 'system'].includes(stored?.theme) ? stored.theme : defaults.theme, fontSize: Number.isFinite(stored?.fontSize) ? Math.max(14, Math.min(24, stored.fontSize)) : 17, width: ['compact', 'standard', 'wide'].includes(stored?.width) ? stored.width : 'standard', serif: stored?.serif === true, sidebar: stored?.sidebar !== false };
  const savedRecent = await loadPreference<Recent[]>('recent', []);
  recent = Array.isArray(savedRecent) ? savedRecent.filter(d => typeof d?.path === 'string' && typeof d?.name === 'string').slice(0, 10) : [];
  applyPreferences(false);
  await showDocument(active);
  document.documentElement.dataset.ready = 'true';
}
void boot().catch(error => { console.error(error); applyPreferences(false); void showDocument(active); toast('部分设置无法载入，仍可打开文档。'); document.documentElement.dataset.ready = 'true'; });
