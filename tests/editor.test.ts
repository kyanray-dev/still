// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { createMarkdownEditor, type MarkdownEditor } from '../src/editor';

const editors: MarkdownEditor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function setup(content = '') {
  const parent = document.createElement('div');
  document.body.append(parent);
  const onChange = vi.fn();
  const onSave = vi.fn();
  const editor = createMarkdownEditor(parent, { onChange, onSave });
  editors.push(editor);
  editor.setDocument('one', content);
  const view = EditorView.findFromDOM(parent.querySelector('.cm-editor')!)!;
  return { parent, editor, view, onChange, onSave };
}

describe('document state and history', () => {
  it('loads and replaces external content without generating editing callbacks or stale undo', () => {
    const { editor, view, onChange } = setup('原文');
    expect(editor.getContent()).toBe('原文');
    expect(onChange).not.toHaveBeenCalled();
    view.dispatch({ changes: { from: 2, insert: '修改' }, userEvent: 'input' });
    expect(onChange).toHaveBeenLastCalledWith('原文修改');
    onChange.mockClear();
    editor.setDocument('one', '外部更新');
    expect(editor.getContent()).toBe('外部更新');
    editor.undo();
    expect(editor.getContent()).toBe('外部更新');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps undo, redo and selection separate for each document', () => {
    const { editor, view } = setup('甲');
    view.dispatch({ changes: { from: 1, insert: '一' }, selection: EditorSelection.cursor(2), userEvent: 'input' });
    editor.setDocument('two', '乙');
    view.dispatch({ changes: { from: 1, insert: '二' }, selection: EditorSelection.cursor(2), userEvent: 'input' });
    editor.setDocument('one', '甲一');
    expect(view.state.selection.main.head).toBe(2);
    editor.undo();
    expect(editor.getContent()).toBe('甲');
    editor.redo();
    expect(editor.getContent()).toBe('甲一');
    editor.setDocument('two', '乙二');
    expect(editor.getContent()).toBe('乙二');
    editor.undo();
    expect(editor.getContent()).toBe('乙');
  });

  it('retains undo when the parent echoes the current document and releases closed state', () => {
    const { editor, view } = setup('A');
    view.dispatch({ changes: { from: 1, insert: 'B' }, userEvent: 'input' });
    editor.setDocument('one', 'AB');
    editor.undo();
    expect(editor.getContent()).toBe('A');
    editor.redo();
    editor.forgetDocument('one');
    editor.setDocument('two', 'C');
    editor.setDocument('one', 'AB');
    editor.undo();
    expect(editor.getContent()).toBe('AB');
  });

  it('preserves current and cached undo when a document receives a saved filename', () => {
    const { editor, view } = setup('A');
    view.dispatch({ changes: { from: 1, insert: 'B' }, userEvent: 'input' });
    editor.renameDocument('one', '/notes/saved.md');
    editor.setDocument('/notes/saved.md', 'AB');
    editor.undo();
    expect(editor.getContent()).toBe('A');
    editor.redo();
    editor.setDocument('two', 'C');
    editor.renameDocument('/notes/saved.md', '/notes/moved.md');
    editor.setDocument('/notes/moved.md', 'AB');
    editor.undo();
    expect(editor.getContent()).toBe('A');
  });

  it('loads Windows and older Mac newlines consistently and clamps selection after reload', () => {
    const { editor, view } = setup('long text');
    view.dispatch({ selection: EditorSelection.cursor(9) });
    expect(() => editor.setDocument('one', 'a\r\n')).not.toThrow();
    expect(editor.getContent()).toBe('a\n');
    expect(view.state.selection.main.head).toBe(2);
    editor.setDocument('one', 'a\rb');
    expect(editor.getContent()).toBe('a\nb');
  });
});

describe('formatting and shortcuts', () => {
  it('wraps selected text, toggles it back and treats each formatting operation as an undo step', () => {
    const { editor, view, onChange } = setup('一段文字');
    view.dispatch({ selection: EditorSelection.range(0, 4) });
    editor.insertFormat('bold');
    expect(editor.getContent()).toBe('**一段文字**');
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('一段文字');
    editor.insertFormat('bold');
    expect(editor.getContent()).toBe('一段文字');
    editor.undo();
    expect(editor.getContent()).toBe('**一段文字**');
    editor.undo();
    expect(editor.getContent()).toBe('一段文字');
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it('formats selected lines and excludes the line just after a trailing newline', () => {
    const { editor, view } = setup('第一行\n第二行\n第三行');
    view.dispatch({ selection: EditorSelection.range(0, 8) });
    editor.insertFormat('list');
    expect(editor.getContent()).toBe('- 第一行\n- 第二行\n第三行');
    editor.insertFormat('list');
    expect(editor.getContent()).toBe('第一行\n第二行\n第三行');
    view.dispatch({ selection: EditorSelection.cursor(0) });
    editor.insertFormat('heading');
    expect(editor.getContent()).toBe('## 第一行\n第二行\n第三行');
    expect(view.state.selection.main.head).toBe(3);
  });

  it('inserts an editable link destination and a safe code fence around multiline code', () => {
    const { editor, view } = setup('链接');
    view.dispatch({ selection: EditorSelection.range(0, 2) });
    editor.insertFormat('link');
    expect(editor.getContent()).toBe('[链接](https://)');
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('https://');
    editor.setDocument('two', 'a\n```\nb');
    view.dispatch({ selection: EditorSelection.range(0, view.state.doc.length) });
    editor.insertFormat('code');
    expect(editor.getContent()).toBe('````\na\n```\nb\n````');
  });

  it('handles save once, prevents browser save and exposes a named editable textbox', () => {
    const { parent, view, onSave } = setup();
    const textbox = parent.querySelector<HTMLElement>('[role="textbox"]')!;
    expect(textbox.getAttribute('aria-label')).toBe('Markdown编辑器');
    expect(textbox.getAttribute('contenteditable')).toBe('true');
    view.focus();
    const event = new KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true });
    textbox.dispatchEvent(event);
    expect(onSave).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('supports both Ctrl+Shift+Z and Ctrl+Y redo shortcuts', () => {
    const { editor, view } = setup('文字');
    view.dispatch({ selection: EditorSelection.range(0, 2) });
    editor.insertFormat('bold');
    editor.undo();
    const press = (key: string, shiftKey = false) => view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
      key, code: key.toLowerCase() === 'y' ? 'KeyY' : 'KeyZ', keyCode: key.toLowerCase() === 'y' ? 89 : 90,
      ctrlKey: true, shiftKey, bubbles: true, cancelable: true,
    }));
    press('Z', true);
    expect(editor.getContent()).toBe('**文字**');
    editor.undo();
    press('y');
    expect(editor.getContent()).toBe('**文字**');
  });
});
