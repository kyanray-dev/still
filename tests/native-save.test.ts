import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const files = new Map<string, Uint8Array>();
const handlers = new Map<string, (event?: CustomEvent) => unknown>();
const saveDialog = vi.fn();
const exit = vi.fn();
const encode = (text: string) => new TextEncoder().encode(text);
const textAt = (path: string) => new TextDecoder().decode(files.get(path));
const missing = () => ({ code: 'NE_FS_NOPATHE', message: 'Missing file' });
const fs = {
  access: vi.fn(async () => {}),
  getStats: vi.fn(async (path: string) => {
    const value = files.get(path);
    if (!value) throw missing();
    return { isFile: true, size: value.byteLength };
  }),
  readBinaryFile: vi.fn(async (path: string) => {
    const value = files.get(path);
    if (!value) throw missing();
    return Uint8Array.from(value).buffer;
  }),
  copy: vi.fn(async (source: string, destination: string) => { files.set(destination, Uint8Array.from(files.get(source)!)); }),
  writeFile: vi.fn(async (path: string, content: string) => { files.set(path, encode(content)); }),
  move: vi.fn(async (source: string, destination: string) => { files.set(destination, files.get(source)!); files.delete(source); }),
  remove: vi.fn(async (path: string) => { files.delete(path); }),
};
vi.doMock('@neutralinojs/lib', () => ({
  init: () => handlers.get('ready')?.(),
  events: { on: async (name: string, handler: (event?: CustomEvent) => unknown) => { handlers.set(name, handler); } },
  os: { showSaveDialog: saveDialog },
  app: { exit },
  filesystem: fs,
}));
const path = 'E:/notes/中文.md';
const original = '# 原始内容\n';
const revised = '# 修改后的内容 👋\n';
const document = () => ({ id: `path:${path}`, name: '中文.md', path, content: revised });

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal('NL_MODE', 'window');
  vi.stubGlobal('NL_OS', 'Windows');
  vi.stubGlobal('NL_CWD', 'E:/notes');
  vi.stubGlobal('NL_ARGS', []);
  handlers.clear();
  files.clear();
  files.set(path, encode(original));
  saveDialog.mockResolvedValue('E:/notes/new.md');
});
afterEach(() => vi.unstubAllGlobals());

describe('safe native Markdown saving', () => {
  it('replaces an existing file only after staging and readback verification', async () => {
    const { saveMarkdown } = await import('../src/platform');
    const result = await saveMarkdown(document(), { expectedContent: original });
    expect(result).toEqual(document());
    expect(textAt(path)).toBe(revised);
    expect(saveDialog).not.toHaveBeenCalled();
    expect(fs.writeFile.mock.calls.every(([target]) => target !== path)).toBe(true);
    expect(fs.copy).toHaveBeenCalledWith(path, expect.stringContaining('.liubai-'), { recursive: false, overwrite: false, skip: false });
    expect(fs.move).toHaveBeenCalledOnce();
    expect(Array.from(files.keys())).toEqual([path]);
  });
  it('saves a new document through a user-selected destination', async () => {
    const { saveMarkdown } = await import('../src/platform');
    const result = await saveMarkdown({ id: 'new', name: '未命名.md', content: revised });
    expect(result?.path).toBe('E:/notes/new.md');
    expect(result?.id).toBe('path:E:/notes/new.md');
    expect(textAt('E:/notes/new.md')).toBe(revised);
    expect(textAt(path)).toBe(original);
  });
  it('leaves files untouched when the user cancels', async () => {
    saveDialog.mockResolvedValue('');
    const { saveMarkdown } = await import('../src/platform');
    expect(await saveMarkdown(document(), { saveAs: true })).toBeNull();
    expect(fs.writeFile).not.toHaveBeenCalled();
  });
  it('allows the caller to reject an already-open destination before any write', async () => {
    const { saveMarkdown } = await import('../src/platform');
    expect(await saveMarkdown(document(), { beforeWrite: async () => false })).toBeNull();
    expect(fs.writeFile).not.toHaveBeenCalled();
  });
  it('detects external changes before overwriting', async () => {
    files.set(path, encode('external version'));
    const { saveMarkdown } = await import('../src/platform');
    await expect(saveMarkdown(document(), { expectedContent: original })).rejects.toMatchObject({ code: 'FILE_CHANGED' });
    expect(textAt(path)).toBe('external version');
    expect(fs.writeFile).not.toHaveBeenCalled();
  });
  it('treats an externally deleted source as a conflict', async () => {
    files.delete(path);
    const { saveMarkdown } = await import('../src/platform');
    await expect(saveMarkdown(document(), { expectedContent: original })).rejects.toMatchObject({ code: 'FILE_CHANGED' });
    expect(files.has(path)).toBe(false);
  });
  it('allows an explicitly confirmed overwrite', async () => {
    files.set(path, encode('external version'));
    const { saveMarkdown } = await import('../src/platform');
    await saveMarkdown(document(), { expectedContent: original, force: true });
    expect(textAt(path)).toBe(revised);
  });
  it('detects an external change that arrives while staging', async () => {
    fs.writeFile.mockImplementationOnce(async (target, content) => {
      files.set(target, encode(content));
      files.set(path, encode('new external version'));
    });
    const { saveMarkdown } = await import('../src/platform');
    await expect(saveMarkdown(document(), { expectedContent: original })).rejects.toMatchObject({ code: 'FILE_CHANGED' });
    expect(textAt(path)).toBe('new external version');
    expect(fs.move).not.toHaveBeenCalled();
    expect(Array.from(files.keys())).toEqual([path]);
  });
  it('preserves the original and input document when the write fails', async () => {
    fs.writeFile.mockRejectedValueOnce(new Error('Disk full'));
    const input = document();
    const { saveMarkdown } = await import('../src/platform');
    await expect(saveMarkdown(input, { expectedContent: original })).rejects.toThrow('Disk full');
    expect(textAt(path)).toBe(original);
    expect(input).toEqual(document());
    expect(Array.from(files.keys())).toEqual([path]);
  });
  it('rejects a read-only original before creating any temporary files', async () => {
    fs.access.mockRejectedValueOnce(new Error('Access denied'));
    const { saveMarkdown } = await import('../src/platform');
    await expect(saveMarkdown(document(), { expectedContent: original })).rejects.toThrow('检查权限');
    expect(fs.copy).not.toHaveBeenCalled();
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(textAt(path)).toBe(original);
  });
  it('catches a truncated write even if the native API reports success', async () => {
    fs.writeFile.mockImplementationOnce(async target => { files.set(target, encode('truncated')); });
    const { saveMarkdown } = await import('../src/platform');
    await expect(saveMarkdown(document(), { expectedContent: original })).rejects.toThrow('保存校验失败');
    expect(textAt(path)).toBe(original);
    expect(fs.move).not.toHaveBeenCalled();
  });
  it('never removes the original when the atomic rename fails', async () => {
    fs.move.mockRejectedValueOnce(new Error('Access denied'));
    const { saveMarkdown } = await import('../src/platform');
    await expect(saveMarkdown(document(), { expectedContent: original })).rejects.toThrow('Access denied');
    expect(textAt(path)).toBe(original);
    expect(fs.remove.mock.calls.every(([target]) => target !== path)).toBe(true);
  });
  it('compares UTF-16 source text and saves the revised document as UTF-8', async () => {
    const bytes = [255, 254];
    for (const char of original) bytes.push(char.charCodeAt(0) & 255, char.charCodeAt(0) >> 8);
    files.set(path, Uint8Array.from(bytes));
    const { saveMarkdown } = await import('../src/platform');
    await saveMarkdown(document(), { expectedContent: original });
    expect(Array.from(files.get(path)!)).toEqual(Array.from(encode(revised)));
  });
  it('enforces the 10 MB UTF-8 byte limit before opening a dialog', async () => {
    const { saveMarkdown } = await import('../src/platform');
    await expect(saveMarkdown({ ...document(), content: '中'.repeat(3_500_000) }, { saveAs: true })).rejects.toThrow('10 MB');
    expect(saveDialog).not.toHaveBeenCalled();
    expect(fs.writeFile).not.toHaveBeenCalled();
  });
});

describe('native window close guard', () => {
  it('serializes repeated close requests and exits only after approval', async () => {
    let release!: (value: boolean) => void;
    const onClose = vi.fn(() => new Promise<boolean>(resolve => { release = resolve; }));
    const { initPlatform } = await import('../src/platform');
    await initPlatform({ onFiles: () => {}, onError: vi.fn(), onClose });
    const first = handlers.get('windowClose')?.();
    await handlers.get('windowClose')?.();
    expect(onClose).toHaveBeenCalledOnce();
    expect(exit).not.toHaveBeenCalled();
    release(false);
    await first;
    expect(exit).not.toHaveBeenCalled();
    const second = handlers.get('windowClose')?.();
    release(true);
    await second;
    expect(exit).toHaveBeenCalledOnce();
  });
  it('keeps the window open if saving during close throws', async () => {
    const onError = vi.fn();
    const { initPlatform } = await import('../src/platform');
    await initPlatform({ onFiles: () => {}, onError, onClose: async () => { throw new Error('Save failed'); } });
    await handlers.get('windowClose')?.();
    expect(exit).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith('Save failed');
  });
});
