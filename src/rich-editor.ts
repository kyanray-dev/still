import { Fragment, Slice, type Node as ProseNode, type MarkType } from 'prosemirror-model';
import { EditorState, Plugin, PluginKey, TextSelection, type Command } from 'prosemirror-state';
import { EditorView, Decoration, DecorationSet, type NodeView } from 'prosemirror-view';
import { baseKeymap, chainCommands, exitCode, setBlockType, toggleMark, wrapIn, lift } from 'prosemirror-commands';
import { keymap } from 'prosemirror-keymap';
import { history, undo, redo, closeHistory } from 'prosemirror-history';
import { inputRules, InputRule, wrappingInputRule, textblockTypeInputRule, undoInputRule } from 'prosemirror-inputrules';
import { splitListItem, sinkListItem, liftListItem, wrapInList } from 'prosemirror-schema-list';
import { tableEditing, goToNextCell } from 'prosemirror-tables';
import { richSchema as schema, parseRichMarkdown, serializeRichMarkdown } from './rich-markdown';
import { isSafeUrl, renderMarkdown } from './markdown';
import DOMPurify from 'dompurify';

export type RichFormat = 'bold' | 'italic' | 'link' | 'code' | 'heading' | 'list' | 'table' | 'quote' | 'task';
type ImageResolver = (source: string) => Promise<string | null>;
interface Callbacks { onChange(content: string): void; onSave(): void; resolveImage?: ImageResolver }
export interface RichEditor {
  setDocument(id: string, content: string): void;
  getContent(): string;
  focus(): void;
  insertFormat(kind: RichFormat): void;
  undo(): void;
  redo(): void;
  renameDocument(oldId: string, newId: string): void;
  forgetDocument(id: string): void;
  destroy(): void;
  setImageResolver(resolver: ImageResolver): void;
  scrollToHeading(id: string): void;
  find(query: string, index?: number): number;
}
interface CachedDocument { state: EditorState; source: string; originalSource: string; originalDoc: ProseNode }

export function sanitizeRichClipboard(html: string): string {
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form'] });
}

function markInputRule(pattern: RegExp, mark: MarkType): InputRule {
  return new InputRule(pattern, (state, match, start, end) => {
    const content = match[1];
    if (!content) return null;
    return state.tr.insertText(content, start, end).addMark(start, start + content.length, mark.create()).setStoredMarks(null);
  });
}

function inputExtensions() {
  return inputRules({ rules: [
    textblockTypeInputRule(/^(#{1,6})\s$/u, schema.nodes.heading, (match) => ({ level: match[1].length })),
    wrappingInputRule(/^\s*>\s$/u, schema.nodes.blockquote),
    wrappingInputRule(/^\s*[-+*]\s$/u, schema.nodes.bullet_list, { tight: true }),
    wrappingInputRule(/^(\d+)\.\s$/u, schema.nodes.ordered_list, (match) => ({ order: Number(match[1]), tight: true }), (match, node) => node.childCount + node.attrs.order === Number(match[1])),
    textblockTypeInputRule(/^```([\w+-]*)\s$/u, schema.nodes.code_block, (match) => ({ params: match[1] })),
    new InputRule(/^\[([ xX])\]\s$/u, (state, match, start, end) => {
      let tr = state.tr.delete(start, end);
      let position: number | undefined;
      for (let depth = tr.selection.$from.depth; depth > 0; depth -= 1) {
        if (tr.selection.$from.node(depth).type === schema.nodes.list_item) { position = tr.selection.$from.before(depth); break; }
      }
      if (position !== undefined) return tr.setNodeMarkup(position, undefined, { checked: match[1].toLowerCase() === 'x' });
      const paragraph = schema.nodes.paragraph.create(null, tr.selection.$from.parent.content);
      const item = schema.nodes.list_item.create({ checked: match[1].toLowerCase() === 'x' }, paragraph);
      const from = tr.selection.$from.before();
      tr = tr.replaceWith(from, from + tr.selection.$from.parent.nodeSize, schema.nodes.bullet_list.create({ tight: true }, item));
      return tr.setSelection(TextSelection.create(tr.doc, from + 3));
    }),
    markInputRule(/\*\*([^*\n]+)\*\*$/u, schema.marks.strong),
    markInputRule(/__([^_\n]+)__$/u, schema.marks.strong),
    markInputRule(/(?<!\*)\*([^*\n]+)\*$/u, schema.marks.em),
    markInputRule(/(?<!_)_([^_\n]+)_$/u, schema.marks.em),
    markInputRule(/`([^`\n]+)`$/u, schema.marks.code),
    markInputRule(/~~([^~\n]+)~~$/u, schema.marks.strike),
    new InputRule(/(?<!\$)\$([^$\n]+)\$$/u, (state, match, start, end) => state.tr.replaceWith(start, end, schema.nodes.math_inline.create({ source: `$${match[1]}$` }))),
    new InputRule(/\[([^\]\n]+)\]\(([^\s)]+)\)$/u, (state, match, start, end) => {
      if (!isSafeUrl(match[2])) return null;
      return state.tr.replaceWith(start, end, schema.text(match[1], [schema.marks.link.create({ href: match[2] })]));
    }),
  ] });
}

const searchKey = new PluginKey<{ query: string; index: number; hits: { from: number; to: number }[]; decorations: DecorationSet }>('rich-search');
function searchState(doc: ProseNode, query: string, index: number) {
  const hits: { from: number; to: number }[] = [];
  if (query) doc.descendants((node, position) => {
    if (!node.isTextblock || hits.length >= 5000) return;
    const text = node.textBetween(0, node.content.size, '', '\ufffc').toLocaleLowerCase();
    let found = text.indexOf(query.toLocaleLowerCase());
    while (found >= 0 && hits.length < 5000) { hits.push({ from: position + 1 + found, to: position + 1 + found + query.length }); found = text.indexOf(query.toLocaleLowerCase(), found + query.length); }
    return false;
  });
  const current = hits.length ? ((index % hits.length) + hits.length) % hits.length : 0;
  const decorations = DecorationSet.create(doc, hits.map((hit, i) => Decoration.inline(hit.from, hit.to, { class: `search-result${i === current ? ' current' : ''}` })));
  return { query, index: current, hits, decorations };
}
function headingDecorations(doc: ProseNode): DecorationSet {
  const used = new Set<string>();
  const decorations: Decoration[] = [];
  doc.descendants((node, position) => {
    if (node.type !== schema.nodes.heading) return;
    let text = '';
    node.descendants((child) => { if (child.isText) text += child.text; else if (child.type.name === 'image') text += child.attrs.alt || ''; else if (child.type.name === 'math_inline') text += child.attrs.source.replace(/^\$|\$$/gu, ''); });
    const slug = text.normalize('NFKC').toLowerCase().trim().replace(/[^\p{Letter}\p{Number}\p{Mark}\s_-]/gu, '').replace(/[\s_]+/gu, '-').replace(/^-+|-+$/gu, '') || 'section';
    let id = `heading-${slug}`;
    for (let suffix = 2; used.has(id); suffix += 1) id = `heading-${slug}-${suffix}`;
    used.add(id);
    decorations.push(Decoration.node(position, position + node.nodeSize, { 'data-heading-id': id }));
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

export function createRichEditor(parent: HTMLElement, callbacks: Callbacks): RichEditor {
  const cache = new Map<string, CachedDocument>();
  const imageRefreshers = new Set<() => void>();
  let imageResolver = callbacks.resolveImage;
  let activeId: string | null = null;
  let currentSource = '';
  let originalSource = '';
  let originalDoc = parseRichMarkdown('');
  let destroyed = false;
  let pendingSave: string | null = null;

  const save: Command = (state, dispatch, view) => {
    if (view?.composing) pendingSave = activeId;
    else callbacks.onSave();
    return true;
  };
  const insertBreak: Command = (state, dispatch) => {
    for (let depth = state.selection.$from.depth; depth > 0; depth -= 1) {
      if (['table_cell', 'table_header'].includes(state.selection.$from.node(depth).type.name)) return true;
    }
    dispatch?.(state.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView());
    return true;
  };
  const plugins = [
    inputExtensions(),
    history(),
    keymap({
      'Mod-b': toggleMark(schema.marks.strong), 'Mod-i': toggleMark(schema.marks.em),
      'Mod-k': () => { showLinkPanel(); return true; },
      'Mod-s': save, 'Mod-z': undo, 'Mod-Shift-z': redo, 'Mod-y': redo,
      'Backspace': undoInputRule,
      'Enter': chainCommands(splitListItem(schema.nodes.list_item), baseKeymap.Enter),
      'Shift-Enter': chainCommands(exitCode, insertBreak),
      'Tab': chainCommands(goToNextCell(1), sinkListItem(schema.nodes.list_item)),
      'Shift-Tab': chainCommands(goToNextCell(-1), liftListItem(schema.nodes.list_item)),
    }),
    keymap(baseKeymap),
    tableEditing(),
    new Plugin({ props: { decorations: (state) => headingDecorations(state.doc) } }),
    new Plugin({ key: searchKey, state: {
      init: (_, state) => searchState(state.doc, '', 0),
      apply: (transaction, previous) => { const update = transaction.getMeta(searchKey); return update ? searchState(transaction.doc, update.query, update.index) : transaction.docChanged ? searchState(transaction.doc, previous.query, previous.index) : previous; },
    }, props: { decorations: (state) => searchKey.getState(state)?.decorations } }),
    new Plugin({ props: {
      attributes: (state) => ({ 'data-empty': String(state.doc.childCount === 1 && state.doc.firstChild?.isTextblock && state.doc.firstChild.content.size === 0) }),
      transformPastedHTML: sanitizeRichClipboard,
      handlePaste(view, event, slice) {
        const text = event.clipboardData?.getData('text/plain');
        if (!text || event.clipboardData?.getData('text/html') || (!/\n/u.test(text) && !/^(?:#{1,6} |[-*+] |\*\*|```|\$)/u.test(text))) return false;
        const parsed = parseRichMarkdown(text);
        view.dispatch(view.state.tr.replaceSelection(new Slice(parsed.content, 0, 0)).scrollIntoView());
        return true;
      },
      handleClick(_view, _pos, event) { if ((event.target as HTMLElement).closest('a')) { event.preventDefault(); return true; } return false; },
      handleDOMEvents: { compositionend: () => { if (pendingSave !== null) { const id = pendingSave; pendingSave = null; setTimeout(() => { if (!destroyed && activeId === id) callbacks.onSave(); }, 0); } return false; } },
    } }),
  ];

  function specialView(initial: ProseNode, view: EditorView, getPos: () => number | undefined): NodeView {
    let node = initial;
    const inline = node.isInline;
    const dom = document.createElement(inline ? 'span' : 'div');
    dom.className = `rich-special rich-${node.type.name.replaceAll('_', '-')}`;
    dom.contentEditable = 'false';
    const preview = document.createElement(inline ? 'span' : 'div');
    preview.className = 'rich-node-preview';
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'rich-node-edit'; edit.textContent = '编辑'; edit.setAttribute('aria-label', node.type.name.startsWith('math') ? '编辑公式' : '编辑片段原文');
    const panel = document.createElement('span'); panel.className = 'rich-source-panel'; panel.hidden = true;
    const textarea = document.createElement('textarea'); textarea.className = 'rich-node-source'; textarea.setAttribute('aria-label', node.type.name.startsWith('math') ? '公式原文' : '片段原文'); textarea.spellcheck = false;
    let composing = false;
    let sourceSaveId: string | null = null;
    const done = document.createElement('button'); done.type = 'button'; done.className = 'rich-node-done'; done.textContent = '完成';
    panel.append(textarea, done); dom.append(preview, edit, panel);
    const render = () => {
      const holder = document.createElement('div'); holder.innerHTML = renderMarkdown(node.attrs.source).html;
      if (inline && holder.children.length === 1 && holder.firstElementChild?.tagName === 'P') preview.replaceChildren(...holder.firstElementChild.childNodes);
      else preview.replaceChildren(...holder.childNodes);
      if (document.activeElement !== textarea) textarea.value = node.attrs.source;
    };
    edit.addEventListener('click', (event) => { event.preventDefault(); panel.hidden = !panel.hidden; if (!panel.hidden) { textarea.value = node.attrs.source; textarea.focus(); } });
    done.addEventListener('click', () => { panel.hidden = true; view.focus(); });
    textarea.addEventListener('input', () => { const position = getPos(); if (position !== undefined) view.dispatch(view.state.tr.setNodeMarkup(position, undefined, { ...node.attrs, source: textarea.value })); });
    textarea.addEventListener('compositionstart', () => { composing = true; });
    textarea.addEventListener('compositionend', () => { composing = false; if (sourceSaveId !== null) { const id = sourceSaveId; sourceSaveId = null; setTimeout(() => { if (!destroyed && activeId === id) callbacks.onSave(); }, 0); } });
    textarea.addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); if (composing || event.isComposing) sourceSaveId = activeId; else callbacks.onSave(); } if (event.key === 'Escape') { panel.hidden = true; view.focus(); } });
    render();
    return { dom, update(next) { if (next.type !== node.type) return false; node = next; render(); return true; }, stopEvent: (event) => Boolean((event.target as HTMLElement).closest('button,textarea,.rich-source-panel')), ignoreMutation: () => true };
  }

  function imageView(initial: ProseNode, view: EditorView, getPos: () => number | undefined): NodeView {
    let node = initial; let alive = true; let version = 0;
    const dom = document.createElement('span'); dom.className = 'rich-image'; dom.contentEditable = 'false';
    const image = document.createElement('img'); image.loading = 'lazy'; image.referrerPolicy = 'no-referrer';
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'rich-node-edit'; edit.textContent = '图片'; edit.setAttribute('aria-label', '编辑图片路径');
    const panel = document.createElement('span'); panel.className = 'rich-source-panel'; panel.hidden = true;
    const input = document.createElement('input'); input.type = 'text'; input.setAttribute('aria-label', '图片路径');
    const done = document.createElement('button'); done.type = 'button'; done.textContent = '完成';
    panel.append(input, done); dom.append(image, edit, panel);
    const refresh = () => {
      const current = ++version;
      image.alt = node.attrs.alt || '图片'; image.title = node.attrs.title || '';
      if (document.activeElement !== input) input.value = node.attrs.src;
      if (/^https:\/\//iu.test(node.attrs.src)) { image.src = node.attrs.src; return; }
      image.removeAttribute('src');
      if (imageResolver && isSafeUrl(node.attrs.src)) void imageResolver(node.attrs.src).then((resolved) => { if (alive && current === version && resolved && /^(?:data:image\/(?:png|jpeg|webp|gif|bmp);base64,|https:\/\/)/iu.test(resolved)) image.src = resolved; }).catch(() => {});
    };
    edit.addEventListener('click', () => { panel.hidden = !panel.hidden; if (!panel.hidden) input.focus(); });
    done.addEventListener('click', () => { panel.hidden = true; view.focus(); });
    input.addEventListener('input', () => { const position = getPos(); if (position !== undefined) view.dispatch(view.state.tr.setNodeMarkup(position, undefined, { ...node.attrs, src: input.value })); });
    imageRefreshers.add(refresh); refresh();
    return { dom, update(next) { if (next.type !== node.type) return false; node = next; refresh(); return true; }, stopEvent: (event) => Boolean((event.target as HTMLElement).closest('button,input,.rich-source-panel')), ignoreMutation: () => true, destroy() { alive = false; imageRefreshers.delete(refresh); } };
  }

  const stateFor = (content: string) => EditorState.create({ schema, doc: parseRichMarkdown(content), plugins });
  const view = new EditorView(parent, {
    state: stateFor(''),
    attributes: { class: 'prose rich-document', role: 'textbox', 'aria-label': '可视编辑器', 'aria-multiline': 'true', spellcheck: 'false', 'data-placeholder': '从一个想法开始……' },
    dispatchTransaction(transaction) {
      if (destroyed) return;
      const next = view.state.applyTransaction(transaction);
      view.updateState(next.state);
      if (next.transactions.some((item) => item.docChanged)) {
        currentSource = next.state.doc.eq(originalDoc) ? originalSource : serializeRichMarkdown(next.state.doc);
        callbacks.onChange(currentSource);
      }
    },
    nodeViews: {
      math_inline: specialView, math_block: specialView, raw_inline: specialView, raw_block: specialView, image: imageView,
      list_item(node, currentView, getPos) {
        if (node.attrs.checked === null) { const dom = document.createElement('li'); return { dom, contentDOM: dom }; }
        const dom = document.createElement('li'); dom.className = 'task-list-item rich-task'; dom.dataset.checked = String(node.attrs.checked);
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = node.attrs.checked; checkbox.contentEditable = 'false'; checkbox.setAttribute('aria-label', '标记任务完成');
        const contentDOM = document.createElement('div'); contentDOM.className = 'rich-task-content'; dom.append(checkbox, contentDOM);
        checkbox.addEventListener('change', () => { const position = getPos(); if (position !== undefined) currentView.dispatch(currentView.state.tr.setNodeMarkup(position, undefined, { ...node.attrs, checked: checkbox.checked })); });
        return { dom, contentDOM, stopEvent: (event) => event.target === checkbox, ignoreMutation: (mutation) => mutation.type !== 'selection' && (mutation.target === checkbox || mutation.target === dom) };
      },
      footnote(node) { const dom = document.createElement('div'); dom.className = 'rich-footnote'; const label = document.createElement('span'); label.contentEditable = 'false'; label.className = 'rich-footnote-label'; label.textContent = `[${node.attrs.label}]`; const contentDOM = document.createElement('div'); contentDOM.className = 'rich-footnote-content'; dom.append(label, contentDOM); return { dom, contentDOM }; },
      code_block(node) { const dom = document.createElement('pre'); dom.className = 'rich-code-block'; dom.dataset.language = node.attrs.params || 'text'; const contentDOM = document.createElement('code'); dom.append(contentDOM); return { dom, contentDOM }; },
    },
  });

  const linkPanel = document.createElement('div'); linkPanel.className = 'rich-link-panel'; linkPanel.hidden = true; linkPanel.setAttribute('role', 'dialog'); linkPanel.setAttribute('aria-label', '设置链接');
  const linkInput = document.createElement('input'); linkInput.type = 'url'; linkInput.setAttribute('aria-label', '链接地址'); linkInput.placeholder = 'https://';
  const linkApply = document.createElement('button'); linkApply.type = 'button'; linkApply.textContent = '应用';
  const linkCancel = document.createElement('button'); linkCancel.type = 'button'; linkCancel.textContent = '取消';
  linkPanel.append(linkInput, linkApply, linkCancel); parent.append(linkPanel);
  let linkBookmark = view.state.selection.getBookmark();
  function showLinkPanel() { linkBookmark = view.state.selection.getBookmark(); linkInput.value = view.state.selection.$from.marks().find((mark) => mark.type === schema.marks.link)?.attrs.href || 'https://'; linkPanel.hidden = false; linkInput.focus(); linkInput.select(); }
  function applyLink() {
    const href = linkInput.value.trim();
    if (href && !isSafeUrl(href)) { linkInput.setCustomValidity('请输入网页、邮件或相对文件地址。'); linkInput.reportValidity(); return; }
    linkInput.setCustomValidity('');
    let transaction = view.state.tr.setSelection(linkBookmark.resolve(view.state.doc));
    const { from, to, empty } = transaction.selection;
    if (empty) transaction = transaction.insertText(href || '链接文字', from).addMark(from, from + (href || '链接文字').length, schema.marks.link.create({ href }));
    else { transaction = transaction.removeMark(from, to, schema.marks.link); if (href) transaction = transaction.addMark(from, to, schema.marks.link.create({ href })); }
    view.dispatch(closeHistory(transaction)); linkPanel.hidden = true; view.focus();
  }
  linkApply.addEventListener('click', applyLink); linkCancel.addEventListener('click', () => { linkPanel.hidden = true; view.focus(); });
  linkInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); applyLink(); } if (event.key === 'Escape') { linkPanel.hidden = true; view.focus(); } });

  const command = (action: Command) => action(view.state, (transaction) => view.dispatch(closeHistory(transaction)), view);
  function format(kind: RichFormat) {
    if (kind === 'bold') command(toggleMark(schema.marks.strong));
    else if (kind === 'italic') command(toggleMark(schema.marks.em));
    else if (kind === 'code') command(toggleMark(schema.marks.code));
    else if (kind === 'link') { showLinkPanel(); return; }
    else if (kind === 'heading') command(setBlockType(view.state.selection.$from.parent.type === schema.nodes.heading ? schema.nodes.paragraph : schema.nodes.heading, { level: 2 }));
    else if (kind === 'quote') {
      let inside = false;
      for (let depth = view.state.selection.$from.depth; depth > 0; depth -= 1) if (view.state.selection.$from.node(depth).type === schema.nodes.blockquote) inside = true;
      command(inside ? lift : wrapIn(schema.nodes.blockquote));
    }
    else if (kind === 'list') {
      command(chainCommands(wrapInList(schema.nodes.bullet_list, { tight: true }), liftListItem(schema.nodes.list_item)));
    } else if (kind === 'task') {
      const { $from } = view.state.selection;
      let existing: number | undefined;
      for (let depth = $from.depth; depth > 0; depth -= 1) if ($from.node(depth).type === schema.nodes.list_item) { existing = $from.before(depth); break; }
      if (existing !== undefined) {
        const item = view.state.doc.nodeAt(existing)!;
        view.dispatch(closeHistory(view.state.tr.setNodeMarkup(existing, undefined, { checked: item.attrs.checked === null ? false : null })));
      } else {
        wrapInList(schema.nodes.bullet_list, { tight: true })(view.state, (transaction) => {
          const selection = transaction.selection.$from;
          for (let depth = selection.depth; depth > 0; depth -= 1) if (selection.node(depth).type === schema.nodes.list_item) { transaction.setNodeMarkup(selection.before(depth), undefined, { checked: false }); break; }
          view.dispatch(closeHistory(transaction));
        }, view);
      }
    } else if (kind === 'table') {
      const rows = Array.from({ length: 3 }, (_, row) => schema.nodes.table_row.create(null, Array.from({ length: 3 }, () => (row === 0 ? schema.nodes.table_header : schema.nodes.table_cell).create(null, schema.nodes.paragraph.create()))));
      const table = schema.nodes.table.create(null, rows);
      const transaction = view.state.tr.replaceSelectionWith(table);
      view.dispatch(closeHistory(transaction.scrollIntoView()));
    }
    view.focus();
  }

  return {
    setDocument(id, content) {
      if (destroyed || (id === activeId && content === currentSource)) return;
      if (activeId !== null) cache.set(activeId, { state: view.state, source: currentSource, originalSource, originalDoc });
      const previous = cache.get(id);
      const restored = previous?.source === content ? previous : undefined;
      const state = restored?.state || stateFor(content);
      activeId = id; currentSource = content; originalSource = restored?.originalSource ?? content; originalDoc = restored?.originalDoc ?? state.doc;
      pendingSave = null;
      linkPanel.hidden = true;
      view.updateState(state);
    },
    getContent: () => currentSource,
    focus: () => { if (!destroyed) view.focus(); },
    insertFormat: (kind) => { if (!destroyed) format(kind); },
    undo: () => { if (!destroyed) { undo(view.state, view.dispatch); view.focus(); } },
    redo: () => { if (!destroyed) { redo(view.state, view.dispatch); view.focus(); } },
    renameDocument(oldId, newId) { if (oldId === newId) return; const existing = cache.get(oldId); if (existing) cache.set(newId, existing); cache.delete(oldId); if (activeId === oldId) activeId = newId; },
    forgetDocument(id) { cache.delete(id); if (activeId === id) activeId = null; },
    setImageResolver(resolver) { imageResolver = resolver; for (const refresh of imageRefreshers) refresh(); },
    scrollToHeading(id) { const heading = [...view.dom.querySelectorAll<HTMLElement>('[data-heading-id]')].find((element) => element.dataset.headingId === id); heading?.scrollIntoView({ block: 'start', behavior: 'smooth' }); },
    find(query, index = 0) { view.dispatch(view.state.tr.setMeta(searchKey, { query: query.trim(), index })); const search = searchKey.getState(view.state)!; if (query && search.hits.length) view.dom.querySelector('.search-result.current')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return search.hits.length; },
    destroy() { if (destroyed) return; destroyed = true; cache.clear(); imageRefreshers.clear(); linkPanel.remove(); view.destroy(); },
  };
}
