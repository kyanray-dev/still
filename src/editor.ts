import { EditorSelection, EditorState, type ChangeSpec, type Extension } from '@codemirror/state';
import { EditorView, drawSelection, keymap, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, isolateHistory, redo, undo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

export type MarkdownFormat = 'bold' | 'italic' | 'link' | 'code' | 'heading' | 'list';

export interface MarkdownEditor {
  setDocument(id: string, content: string): void;
  getContent(): string;
  focus(): void;
  insertFormat(kind: MarkdownFormat): void;
  undo(): void;
  redo(): void;
  renameDocument(oldId: string, newId: string): void;
  forgetDocument(id: string): void;
  destroy(): void;
}

interface EditorCallbacks {
  onChange(content: string): void;
  onSave(): void;
}

interface SavedDocument {
  state: EditorState;
  scrollTop: number;
  scrollLeft: number;
}

const highlighting = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--ink)', fontWeight: '600' },
  { tag: tags.strong, fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'var(--accent)', textDecoration: 'underline', textUnderlineOffset: '3px' },
  { tag: tags.url, color: 'var(--secondary)' },
  { tag: [tags.monospace, tags.string], color: 'var(--accent)' },
  { tag: [tags.meta, tags.processingInstruction], color: 'var(--muted)' },
  { tag: tags.quote, color: 'var(--secondary)' },
  { tag: [tags.keyword, tags.atom], color: 'var(--accent)' },
  { tag: tags.comment, color: 'var(--muted)', fontStyle: 'italic' },
]);

const editorTheme = EditorView.theme({
  '&': { height: '100%', color: 'var(--ink)', backgroundColor: 'var(--paper)', fontSize: '14px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", "PingFang SC", "Microsoft YaHei", monospace',
    lineHeight: '1.85',
  },
  '.cm-content': { padding: '30px 0 70px', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0 30px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--accent-soft)' },
  '.cm-placeholder': { color: 'var(--muted)' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-panels': { backgroundColor: 'var(--sidebar)', color: 'var(--ink)' },
  '.cm-button': { color: 'var(--ink)', background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: '4px' },
  '.cm-textfield': { color: 'var(--ink)', background: 'var(--paper)', border: '1px solid var(--line)' },
  '@media (max-width: 760px)': { '.cm-line': { padding: '0 20px' } },
});

function surround(view: EditorView, delimiter: string, fallback: string): void {
  const { state } = view;
  const { from, to } = state.selection.main;
  const selected = state.sliceDoc(from, to);
  const before = state.sliceDoc(Math.max(0, from - delimiter.length), from);
  const after = state.sliceDoc(to, to + delimiter.length);
  let replaceFrom = from;
  let replaceTo = to;
  let replacement: string;
  let selectionFrom: number;
  let selectionTo: number;

  if (before === delimiter && after === delimiter && from >= delimiter.length) {
    replaceFrom -= delimiter.length;
    replaceTo += delimiter.length;
    replacement = selected;
    selectionFrom = replaceFrom;
    selectionTo = replaceFrom + selected.length;
  } else if (selected.startsWith(delimiter) && selected.endsWith(delimiter) && selected.length > delimiter.length * 2) {
    replacement = selected.slice(delimiter.length, -delimiter.length);
    selectionFrom = from;
    selectionTo = from + replacement.length;
  } else {
    const content = selected || fallback;
    replacement = `${delimiter}${content}${delimiter}`;
    selectionFrom = from + delimiter.length;
    selectionTo = selectionFrom + content.length;
  }

  view.dispatch({
    changes: { from: replaceFrom, to: replaceTo, insert: replacement },
    selection: EditorSelection.range(selectionFrom, selectionTo),
    annotations: isolateHistory.of('full'),
    userEvent: 'input.format',
    scrollIntoView: true,
  });
}

function formatLines(view: EditorView, kind: 'heading' | 'list'): void {
  const { state } = view;
  const { from, to, empty } = state.selection.main;
  const first = state.doc.lineAt(from);
  // A selection ending at the next line's start should not format that line.
  const last = state.doc.lineAt(to > from && state.doc.lineAt(to).from === to ? to - 1 : to);
  const lines = Array.from({ length: last.number - first.number + 1 }, (_, index) => state.doc.line(first.number + index));
  const prefix = kind === 'heading' ? /^(\s{0,3})#{1,6}\s+/u : /^(\s*)[-+*]\s+/u;
  const remove = lines.every((line) => prefix.test(line.text));
  const changes: ChangeSpec[] = lines.map((line) => {
    const match = line.text.match(prefix);
    const indentation = match?.[1] ?? line.text.match(/^\s*/u)?.[0] ?? '';
    const consumed = match ? match[0].length : indentation.length;
    const marker = remove ? '' : kind === 'heading' ? '## ' : '- ';
    return { from: line.from, to: line.from + consumed, insert: indentation + marker };
  });
  const changeSet = state.changes(changes);
  view.dispatch({
    changes: changeSet,
    selection: EditorSelection.range(changeSet.mapPos(from, 1), changeSet.mapPos(to, empty ? 1 : -1)),
    annotations: isolateHistory.of('full'),
    userEvent: 'input.format',
    scrollIntoView: true,
  });
}

function formatSelection(view: EditorView, kind: MarkdownFormat): boolean {
  if (kind === 'bold' || kind === 'italic') {
    surround(view, kind === 'bold' ? '**' : '*', '文字');
  } else if (kind === 'heading' || kind === 'list') {
    formatLines(view, kind);
  } else {
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to);
    if (kind === 'code' && !selected.includes('\n')) {
      const longestRun = [...selected.matchAll(/`+/gu)].reduce((longest, match) => Math.max(longest, match[0].length), 0);
      surround(view, '`'.repeat(longestRun + 1), '代码');
    } else if (kind === 'code') {
      const ticks = '`'.repeat([...selected.matchAll(/`+/gu)].reduce((longest, match) => Math.max(longest, match[0].length + 1), 3));
      const before = from > 0 && view.state.sliceDoc(from - 1, from) !== '\n' ? '\n' : '';
      const after = to < view.state.doc.length && view.state.sliceDoc(to, to + 1) !== '\n' ? '\n' : '';
      const opening = `${before}${ticks}\n`;
      const body = selected.endsWith('\n') ? selected : `${selected}\n`;
      view.dispatch({
        changes: { from, to, insert: `${opening}${body}${ticks}${after}` },
        selection: EditorSelection.range(from + opening.length, from + opening.length + selected.length),
        annotations: isolateHistory.of('full'), userEvent: 'input.format', scrollIntoView: true,
      });
    } else {
      const label = (selected || '链接文字').replace(/([\[\]])/gu, '\\$1');
      const opening = `[${label}](`;
      const address = 'https://';
      view.dispatch({
        changes: { from, to, insert: `${opening}${address})` },
        selection: EditorSelection.range(from + opening.length, from + opening.length + address.length),
        annotations: isolateHistory.of('full'), userEvent: 'input.format', scrollIntoView: true,
      });
    }
  }
  view.focus();
  return true;
}

export function createMarkdownEditor(parent: HTMLElement, callbacks: EditorCallbacks): MarkdownEditor {
  const documents = new Map<string, SavedDocument>();
  let activeId: string | null = null;
  let destroyed = false;
  let changingDocument = false;

  const extensions: Extension[] = [
    markdown(),
    history(),
    drawSelection(),
    EditorView.lineWrapping,
    indentUnit.of('  '),
    syntaxHighlighting(highlighting),
    editorTheme,
    placeholder('从一个想法开始……'),
    EditorView.contentAttributes.of({ role: 'textbox', 'aria-label': 'Markdown编辑器', 'aria-multiline': 'true', spellcheck: 'false', autocapitalize: 'off' }),
    keymap.of([
      { key: 'Mod-b', run: (view) => formatSelection(view, 'bold') },
      { key: 'Mod-i', run: (view) => formatSelection(view, 'italic') },
      { key: 'Mod-k', run: (view) => formatSelection(view, 'link') },
      { key: 'Mod-s', run: () => { callbacks.onSave(); return true; }, preventDefault: true },
      { key: 'Mod-Shift-z', run: redo, preventDefault: true },
      { key: 'Mod-y', run: redo, preventDefault: true },
      ...historyKeymap,
      indentWithTab,
      ...defaultKeymap,
    ]),
    EditorView.updateListener.of((update) => {
      if (destroyed || changingDocument || !update.docChanged) return;
      callbacks.onChange(update.state.doc.toString());
    }),
  ];
  const createState = (content: string, selection?: EditorSelection) => EditorState.create({ doc: content, selection, extensions });
  const view = new EditorView({ state: createState(''), parent });

  return {
    setDocument(id, content) {
      if (destroyed) return;
      // The editor uses one newline internally on every supported platform.
      content = content.replace(/\r\n?/gu, '\n');
      if (activeId === id && view.state.doc.toString() === content) return;
      if (activeId !== null) {
        documents.set(activeId, { state: view.state, scrollTop: view.scrollDOM.scrollTop, scrollLeft: view.scrollDOM.scrollLeft });
      }
      const cached = documents.get(id);
      const sameContent = cached?.state.doc.toString() === content;
      const selected = cached?.state.selection.main;
      const state = sameContent ? cached.state : createState(content, selected
        ? EditorSelection.single(Math.min(selected.anchor, content.length), Math.min(selected.head, content.length))
        : undefined);
      activeId = id;
      changingDocument = true;
      try { view.setState(state); } finally { changingDocument = false; }
      const scrollTop = sameContent ? cached.scrollTop : 0;
      const scrollLeft = sameContent ? cached.scrollLeft : 0;
      view.requestMeasure({
        read: () => null,
        write: () => {
          if (!destroyed && activeId === id) {
            view.scrollDOM.scrollTop = scrollTop;
            view.scrollDOM.scrollLeft = scrollLeft;
          }
        },
      });
    },
    getContent: () => view.state.doc.toString(),
    focus: () => { if (!destroyed) view.focus(); },
    insertFormat: (kind) => { if (!destroyed) formatSelection(view, kind); },
    undo: () => { if (!destroyed) { undo(view); view.focus(); } },
    redo: () => { if (!destroyed) { redo(view); view.focus(); } },
    renameDocument(oldId, newId) {
      if (oldId === newId) return;
      const cached = documents.get(oldId);
      if (cached) documents.set(newId, cached);
      documents.delete(oldId);
      if (activeId === oldId) activeId = newId;
    },
    forgetDocument(id) {
      documents.delete(id);
      if (activeId === id) activeId = null;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      documents.clear();
      view.destroy();
    },
  };
}
