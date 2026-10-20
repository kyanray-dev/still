import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const files = new Map<string, Uint8Array>();
const handlers = new Map<string, (event?: CustomEvent) => unknown>();
const broadcast = vi.fn(async (_name: string) => {});
const getStats = vi.fn(async (path: string) => {
  const content = files.get(path);
  if (!content) throw new Error(`无法读取：${path}`);
  return { isFile: true, size: content.byteLength };
});
const readBinaryFile = vi.fn(async (path: string) => Uint8Array.from(files.get(path)!).buffer);
const setMainMenu = vi.fn(async () => {});
vi.doMock('@neutralinojs/lib', () => ({
  init: () => handlers.get('ready')?.(),
  events: {
    on: async (name: string, handler: (event?: CustomEvent) => unknown) => { handlers.set(name, handler); },
    broadcast,
  },
  app: { exit: vi.fn() },
  window: { setMainMenu },
  filesystem: { getStats, readBinaryFile },
}));

const firstPath = '/Users/读者/中文 文档/开源生态报告_整合版.md';
const secondPath = '/Users/读者/中文 文档/笔记 [草稿] #1%.markdown';
const firstContent = '# 开源生态报告\n\n来自 Finder 的中文内容。\n';
const secondContent = '# 第二份文档\n\n保留路径中的空格和符号。\n';
const expectedDocument = (path: string, content: string) => ({
  id: `path:${path}`, name: path.split('/').pop(), path, content,
});
const eventFor = (detail: unknown) => new CustomEvent('filesOpened', { detail });

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal('NL_MODE', 'window');
  vi.stubGlobal('NL_OS', 'Darwin');
  vi.stubGlobal('NL_CWD', '/Users/读者');
  vi.stubGlobal('NL_ARGS', ['/Applications/留白.app/Contents/MacOS/liubai']);
  handlers.clear();
  files.clear();
  files.set(firstPath, new TextEncoder().encode(firstContent));
  files.set(secondPath, new TextEncoder().encode(secondContent));
  broadcast.mockImplementation(async () => {});
});
afterEach(() => vi.unstubAllGlobals());

describe('macOS Finder document opening', () => {
  it('can receive queued cold-launch documents immediately when it announces readiness', async () => {
    const onFiles = vi.fn();
    const onError = vi.fn();
    broadcast.mockImplementation(async name => {
      if (name === 'stillOpenFilesReady') {
        expect(handlers.has('filesOpened')).toBe(true);
        await handlers.get('filesOpened')!(eventFor([firstPath, secondPath]));
      }
    });
    const { initPlatform } = await import('../src/platform');
    await initPlatform({ onFiles, onError });

    expect(broadcast).toHaveBeenCalledWith('stillOpenFilesReady');
    await vi.waitFor(() => expect(onFiles).toHaveBeenCalledWith([
      expectedDocument(firstPath, firstContent), expectedDocument(secondPath, secondContent),
    ]));
    expect(onError).not.toHaveBeenCalled();
  });

  it('opens additional Finder requests after the application is already running', async () => {
    const onFiles = vi.fn();
    const onError = vi.fn();
    const { initPlatform } = await import('../src/platform');
    await initPlatform({ onFiles, onError });

    await handlers.get('filesOpened')!(eventFor([firstPath]));
    await vi.waitFor(() => expect(onFiles).toHaveBeenCalledWith([expectedDocument(firstPath, firstContent)]));
    await handlers.get('filesOpened')!(eventFor([secondPath]));
    await vi.waitFor(() => expect(onFiles).toHaveBeenCalledWith([expectedDocument(secondPath, secondContent)]));
    expect(readBinaryFile.mock.calls.map(([path]) => path)).toEqual([firstPath, secondPath]);
    expect(onError).not.toHaveBeenCalled();
  });

  it('keeps a second Finder request behind an unfinished document-open decision', async () => {
    let finishFirstOpen!: () => void;
    const onFiles = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finishFirstOpen = resolve; }));
    const { initPlatform } = await import('../src/platform');
    await initPlatform({ onFiles, onError: vi.fn() });

    const first = handlers.get('filesOpened')!(eventFor([firstPath]));
    await vi.waitFor(() => expect(onFiles).toHaveBeenCalledOnce());
    const second = handlers.get('filesOpened')!(eventFor([secondPath]));
    await Promise.resolve();
    expect(readBinaryFile.mock.calls.map(([path]) => path)).toEqual([firstPath]);

    finishFirstOpen();
    await Promise.all([first, second]);
    expect(onFiles.mock.calls).toEqual([
      [[expectedDocument(firstPath, firstContent)]],
      [[expectedDocument(secondPath, secondContent)]],
    ]);
  });

  it('ignores malformed event values before trying to read paths', async () => {
    const onFiles = vi.fn();
    const onError = vi.fn();
    const { initPlatform } = await import('../src/platform');
    await initPlatform({ onFiles, onError });

    await handlers.get('filesOpened')!(eventFor(null));
    await handlers.get('filesOpened')!(eventFor({ unrelated: true }));
    await handlers.get('filesOpened')!(eventFor([null, 42, {}, firstPath]));
    await vi.waitFor(() => expect(onFiles).toHaveBeenCalledOnce());
    expect(onFiles).toHaveBeenCalledWith([expectedDocument(firstPath, firstContent)]);
    expect(getStats.mock.calls.map(([path]) => path)).toEqual([firstPath]);
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports an unreadable file while opening the other files in the request', async () => {
    const missingPath = '/Users/读者/已移走的文档.md';
    const onFiles = vi.fn();
    const onError = vi.fn();
    const { initPlatform } = await import('../src/platform');
    await initPlatform({ onFiles, onError });

    await handlers.get('filesOpened')!(eventFor([missingPath, firstPath]));
    await vi.waitFor(() => expect(onFiles).toHaveBeenCalledWith([expectedDocument(firstPath, firstContent)]));
    expect(onError).toHaveBeenCalledWith(`无法读取：${missingPath}`);
    expect(readBinaryFile).toHaveBeenCalledOnce();
  });

  it('preserves command-line document opening on other desktop platforms', async () => {
    vi.stubGlobal('NL_OS', 'Windows');
    vi.stubGlobal('NL_ARGS', ['E:/Still/liubai.exe', '--debug-mode', firstPath]);
    const onFiles = vi.fn();
    const onError = vi.fn();
    const { initPlatform } = await import('../src/platform');
    await initPlatform({ onFiles, onError });

    expect(onFiles).toHaveBeenCalledWith([expectedDocument(firstPath, firstContent)]);
    expect(broadcast).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
