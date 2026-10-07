// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRichEditor, sanitizeRichClipboard, type RichEditor } from '../src/rich-editor';

const editors: RichEditor[] = [];
beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); document.body.replaceChildren(); });

function setup(content = '正文') {
  const parent = document.createElement('div'); document.body.append(parent);
  const onChange = vi.fn(); const onSave = vi.fn();
  const editor = createRichEditor(parent, { onChange, onSave }); editors.push(editor);
  editor.setDocument('one', content);
  return { parent, editor, onChange, onSave };
}

describe('visual editing lifecycle', () => {
  it('renders directly editable semantic HTML without rewriting original Markdown on open', () => {
    const original = '# 标题\r\n\r\n**文字**\r\n';
    const { parent, editor, onChange } = setup(original);
    expect(parent.querySelector('[role="textbox"]')?.getAttribute('aria-label')).toBe('可视编辑器');
    expect(parent.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('true');
    expect(parent.querySelector('h1')?.textContent).toBe('标题');
    expect(parent.querySelector('strong')?.textContent).toBe('文字');
    expect(editor.getContent()).toBe(original);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps independent undo through document switches, same-content echoes and Save As', () => {
    const { editor, parent } = setup('甲\n');
    editor.insertFormat('heading');
    expect(editor.getContent()).toBe('## 甲');
    editor.setDocument('one', '## 甲');
    editor.renameDocument('one', 'saved.md');
    editor.setDocument('two', '乙');
    editor.insertFormat('quote');
    expect(editor.getContent()).toBe('> 乙');
    editor.setDocument('saved.md', '## 甲');
    editor.undo();
    expect(editor.getContent()).toBe('甲\n');
    editor.redo();
    expect(parent.querySelector('h2')?.textContent).toBe('甲');
    editor.setDocument('two', '> 乙');
    editor.undo();
    expect(editor.getContent()).toBe('乙');
  });

  it('reloads external source without retaining stale undo history', () => {
    const { editor, onChange } = setup();
    editor.insertFormat('heading');
    onChange.mockClear();
    editor.setDocument('one', '磁盘更新');
    editor.undo();
    expect(editor.getContent()).toBe('磁盘更新');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('inserts a directly editable three-column table and undoes it cleanly', () => {
    const { editor, parent } = setup('');
    editor.insertFormat('table');
    expect(parent.querySelectorAll('th')).toHaveLength(3);
    expect(parent.querySelectorAll('td')).toHaveLength(6);
    expect(editor.getContent()).toContain('| --- | --- | --- |');
    editor.undo();
    expect(editor.getContent()).toBe('');
  });

  it('keeps task toggles and node-source changes in the same document and save callbacks', () => {
    const { editor, parent, onChange, onSave } = setup('- [ ] 待办\n\n公式 $x^2$');
    const checkbox = parent.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    checkbox.checked = true; checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    expect(editor.getContent()).toContain('[x] 待办');
    parent.querySelector<HTMLButtonElement>('[aria-label="编辑公式"]')!.click();
    const source = parent.querySelector<HTMLTextAreaElement>('[aria-label="公式原文"]')!;
    source.value = '$y^2$'; source.dispatchEvent(new Event('input', { bubbles: true }));
    expect(editor.getContent()).toContain('$y^2$');
    source.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('keeps raw markup inert, searches formatted text and clears decorations', () => {
    const { editor, parent } = setup('文字 **查找** 文字\n\n<script>alert(1)</script>');
    expect(parent.querySelector('script')).toBeNull();
    expect(parent.querySelector('.rich-node-preview')?.textContent).toContain('<script>alert(1)</script>');
    expect(editor.find('文字', 1)).toBe(2);
    expect(parent.querySelectorAll('.search-result')).toHaveLength(2);
    expect(parent.querySelectorAll('.search-result.current')).toHaveLength(1);
    expect(editor.find('')).toBe(0);
    expect(parent.querySelector('.search-result')).toBeNull();
  });

  it('formats a task in one undo step and toggles existing task/list and quotation formats', () => {
    const { editor } = setup('待办');
    editor.insertFormat('task');
    expect(editor.getContent()).toContain('[ ] 待办');
    editor.undo();
    expect(editor.getContent()).toBe('待办');
    editor.redo();
    editor.insertFormat('task');
    expect(editor.getContent()).not.toContain('[ ]');
    editor.setDocument('two', '引用');
    editor.insertFormat('quote');
    editor.insertFormat('quote');
    expect(editor.getContent()).toBe('引用');
  });

  it('cleans active clipboard HTML while retaining visible formatting and table text', () => {
    const holder = document.createElement('div');
    holder.innerHTML = sanitizeRichClipboard('<strong onclick="alert(1)">保留</strong><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">链接</a><table><tr><td>表格</td></tr></table>');
    expect(holder.querySelector('script,[onclick],[onerror],[href^="javascript:"]')).toBeNull();
    expect(holder.querySelector('strong')?.textContent).toBe('保留');
    expect(holder.querySelector('td')?.textContent).toBe('表格');
  });
});
