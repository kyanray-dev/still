export interface OpenDocument {
  id: string;
  name: string;
  path?: string;
  content: string;
}

interface NativeGlobals {
  NL_MODE?: string;
  NL_ARGS?: string[];
  NL_OS?: string;
  NL_CWD?: string;
}

interface PlatformCallbacks {
  onFiles: (documents: OpenDocument[]) => void | Promise<void>;
  onError: (message: string) => void;
  onClose?: () => boolean | Promise<boolean>;
}

export interface SaveMarkdownOptions {
  saveAs?: boolean;
  expectedContent?: string;
  force?: boolean;
  beforeWrite?: (path: string) => boolean | Promise<boolean>;
}

const globals = globalThis as typeof globalThis & NativeGlobals;
export const isNative = typeof globals.NL_MODE === 'string';
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const DOCUMENT_EXTENSION = /\.(md|markdown|mdown|mkd|txt)$/i;
let nativeModule: typeof import('@neutralinojs/lib') | undefined;
let nativeReady: Promise<void> | undefined;
let callbacks: PlatformCallbacks | undefined;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return '无法读取文件，请检查文件是否存在以及访问权限。';
}

async function getNative() {
  if (!isNative) throw new Error('此功能需要桌面版。');
  if (!nativeReady) {
    nativeReady = (async () => {
      nativeModule = await import('@neutralinojs/lib');
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('连接桌面服务超时，请重新打开应用。')), 10000);
        nativeModule!.events.on('ready', () => { clearTimeout(timeout); resolve(); });
        nativeModule!.init();
      });
    })();
  }
  await nativeReady;
  return nativeModule!;
}

export async function initPlatform(handlers: PlatformCallbacks): Promise<void> {
  callbacks = handlers;
  if (!isNative) return;
  const native = await getNative();
  const openPaths = async (paths: string[]) => {
    const documents: OpenDocument[] = [];
    for (const path of paths) {
      try { documents.push(await readDocument(path)); }
      catch (error) { handlers.onError(errorMessage(error)); }
    }
    if (documents.length) await handlers.onFiles(documents);
  };
  await native.events.on('filesDropped', (event: CustomEvent) => {
    const detail = event.detail;
    const paths = Array.isArray(detail) ? detail : detail?.files;
    if (Array.isArray(paths)) void openPaths(paths.filter((path): path is string => typeof path === 'string'));
  });
  await native.events.on('newWindowRequest', (event: CustomEvent) => {
    const url = typeof event.detail === 'string' ? event.detail : event.detail?.url;
    if (typeof url === 'string') void openExternal(url).catch(error => handlers.onError(errorMessage(error)));
  });
  let closing = false;
  await native.events.on('windowClose', async () => {
    if (closing) return;
    closing = true;
    try {
      const mayClose = handlers.onClose ? await handlers.onClose() : true;
      if (mayClose) await native.app.exit();
    } catch (error) { handlers.onError(errorMessage(error)); }
    finally { closing = false; }
  });
  const args = (globals.NL_ARGS ?? []).slice(1).filter(arg => !arg.startsWith('--') && DOCUMENT_EXTENSION.test(arg));
  if (args.length) await openPaths(args);
}

function checkDocument(name: string, size: number): void {
  if (!DOCUMENT_EXTENSION.test(name)) throw new Error('请选择 Markdown 或纯文本文件。');
  if (size > MAX_DOCUMENT_BYTES) throw new Error(`「${name}」超过 10 MB，请选择较小的文件。`);
}

export function decodeDocument(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
    : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
  try { return new TextDecoder(encoding, { fatal: true }).decode(buffer).replace(/^\uFEFF/, ''); }
  catch { throw new Error('文件编码无法识别，请先将文件另存为 UTF-8。'); }
}

export async function documentFromFile(file: File): Promise<OpenDocument> {
  checkDocument(file.name, file.size);
  return {
    id: `file:${file.name}:${file.size}:${file.lastModified}`,
    name: file.name,
    content: decodeDocument(await file.arrayBuffer()),
  };
}

export async function readDocument(path: string): Promise<OpenDocument> {
  const native = await getNative();
  const name = path.replace(/\\/g, '/').split('/').pop() || '未命名.md';
  const stats = await native.filesystem.getStats(path);
  if (!stats.isFile) throw new Error('请选择文件。');
  checkDocument(name, stats.size);
  const normalized = normalizeDocumentPath(path);
  const bytes = await native.filesystem.readBinaryFile(normalized, { pos: 0, size: MAX_DOCUMENT_BYTES + 1 });
  checkDocument(name, bytes.byteLength);
  return { id: `path:${normalized}`, name, path: normalized, content: decodeDocument(bytes) };
}

function normalizeDocumentPath(path: string): string {
  // Preserve Unicode: native absolute-path conversion can use a Windows code page.
  const slashes = path.replace(/\\/g, '/');
  const absolute = /^(?:[a-z]:\/|\/)/i.test(slashes)
    ? slashes : `${(globals.NL_CWD || '').replace(/\\/g, '/').replace(/\/$/, '')}/${slashes}`;
  const prefix = absolute.startsWith('//') ? '//' : absolute.startsWith('/') ? '/' : '';
  const parts: string[] = [];
  for (const part of absolute.slice(prefix.length).split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (parts.length && !/^[a-z]:$/i.test(parts.at(-1)!)) parts.pop(); }
    else parts.push(part);
  }
  return prefix + parts.join('/');
}

function fileChanged(): Error & { code: string } {
  return Object.assign(new Error('文件已在其他程序中修改或移走，请选择另存为或确认覆盖。'), { code: 'FILE_CHANGED' });
}

function samePath(first: string, second: string): boolean {
  const a = normalizeDocumentPath(first), b = normalizeDocumentPath(second);
  return globals.NL_OS === 'Windows' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export async function saveMarkdown(doc: OpenDocument, options: SaveMarkdownOptions = {}): Promise<OpenDocument | null> {
  const content = doc.content;
  const encoded = new TextEncoder().encode(content);
  if (encoded.byteLength > MAX_DOCUMENT_BYTES) throw new Error('文档超过 10 MB，暂时无法保存。');
  if (!isNative) {
    const name = doc.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\.[^.]*$/, '') + '.md';
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { ...doc, name, path: undefined };
  }
  const native = await getNative();
  let selected = doc.path;
  if (options.saveAs || !selected) {
    const name = doc.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
    selected = await native.os.showSaveDialog('保存 Markdown', {
      defaultPath: doc.path || (DOCUMENT_EXTENSION.test(name) ? name : `${name}.md`),
      filters: [{ name: 'Markdown / 文本', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] }],
    });
    if (!selected) return null;
  }
  const path = normalizeDocumentPath(selected);
  const name = path.split('/').pop()!;
  checkDocument(name, encoded.byteLength);
  if (options.beforeWrite && !(await options.beforeWrite(path))) return null;

  const readExisting = async (): Promise<string | null> => {
    let stats;
    try { stats = await native.filesystem.getStats(path); }
    catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'NE_FS_NOPATHE') return null;
      throw error;
    }
    if (!stats.isFile) throw new Error('保存位置不是普通文件，请选择其他位置。');
    if (stats.size > MAX_DOCUMENT_BYTES) throw new Error('目标文件超过 10 MB，请另存为新文件。');
    const bytes = await native.filesystem.readBinaryFile(path, { pos: 0, size: MAX_DOCUMENT_BYTES + 1 });
    if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error('目标文件超过 10 MB，请另存为新文件。');
    return decodeDocument(bytes);
  };
  const original = await readExisting();
  if (!options.force && doc.path && samePath(path, doc.path) && options.expectedContent !== undefined && original !== options.expectedContent) throw fileChanged();
  if (original !== null) {
    try { await native.filesystem.access(path, 2); }
    catch { throw new Error('无法写入此文件，请检查权限或选择另存为。'); }
  }
  const directory = path.slice(0, path.lastIndexOf('/') + 1);
  const temporary = `${directory}.${name}.liubai-${crypto.randomUUID()}.tmp`;
  let moved = false;
  try {
    // Copy existing file attributes and permissions to the staging file first.
    if (original !== null) await native.filesystem.copy(path, temporary, { recursive: false, overwrite: false, skip: false });
    // Write and verify a sibling file first; a failed write never truncates the original.
    await native.filesystem.writeFile(temporary, content);
    const staged = await native.filesystem.readBinaryFile(temporary, { pos: 0, size: MAX_DOCUMENT_BYTES + 1 });
    const stagedBytes = new Uint8Array(staged);
    if (stagedBytes.length !== encoded.length || stagedBytes.some((byte, index) => byte !== encoded[index])) throw new Error('保存校验失败，原文件保持不变。');
    // Check again after writing to narrow the external-edit race. No lock is held.
    if (await readExisting() !== original) throw fileChanged();
    // The native API uses std::filesystem::rename. Same-directory replacement is
    // atomic on the supported local filesystems; never remove the original first.
    await native.filesystem.move(temporary, path);
    moved = true;
    if (await readExisting() !== content) throw new Error('保存后校验失败，编辑内容仍保留，请另存为。');
    return { ...doc, id: `path:${path}`, name, path, content };
  } finally {
    if (!moved) {
      try {
        const stats = await native.filesystem.getStats(temporary);
        if (stats.isFile) await native.filesystem.remove(temporary);
      } catch { /* A failed cleanup may leave only our uniquely named temporary file. */ }
    }
  }
}

export async function openDocuments(): Promise<OpenDocument[]> {
  if (isNative) {
    const native = await getNative();
    const paths = await native.os.showOpenDialog('打开 Markdown', {
      multiSelections: true,
      filters: [{ name: 'Markdown / 文本', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] }],
    });
    const documents: OpenDocument[] = [];
    for (const path of paths) {
      try { documents.push(await readDocument(path)); }
      catch (error) {
        if (callbacks) callbacks.onError(errorMessage(error));
        else throw error;
      }
    }
    return documents;
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.mdown,.mkd,.txt,text/markdown,text/plain';
    input.multiple = true;
    input.hidden = true;
    document.body.append(input);
    const clean = () => input.remove();
    input.addEventListener('change', async () => {
      try { resolve(await Promise.all(Array.from(input.files ?? []).map(documentFromFile))); }
      catch (error) { reject(error); }
      finally { clean(); }
    }, { once: true });
    input.addEventListener('cancel', () => { clean(); resolve([]); }, { once: true });
    input.click();
  });
}

/** Only descendants of the document's own directory may become local image paths. */
export function scopedImagePath(src: string, docPath: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(src.split(/[?#]/, 1)[0] ?? ''); }
  catch { return null; }
  decoded = decoded.replace(/\\/g, '/');
  if (!decoded || /[\u0000-\u001f:]/.test(decoded) || decoded.startsWith('/')) return null;
  const stack: string[] = [];
  for (const part of decoded.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') { if (!stack.length) return null; stack.pop(); }
    else stack.push(part);
  }
  if (!stack.length || !/\.(png|jpe?g|webp|gif|bmp)$/i.test(stack.at(-1)!)) return null;
  const normalized = docPath.replace(/\\/g, '/');
  const directory = normalized.slice(0, normalized.lastIndexOf('/') + 1);
  return directory ? `${directory}${stack.join('/')}` : null;
}

function imageMime(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (String.fromCharCode(...bytes.slice(0, 6)).match(/^GIF8[79]a$/)) return 'image/gif';
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
  return null;
}

export async function resolveImage(src: string, docPath?: string): Promise<string | null> {
  if (!isNative || !docPath) return null;
  const path = scopedImagePath(src, docPath);
  if (!path) return null;
  try {
    const native = await getNative();
    const stats = await native.filesystem.getStats(path);
    if (!stats.isFile || stats.size > MAX_DOCUMENT_BYTES) return null;
    const data = new Uint8Array(await native.filesystem.readBinaryFile(path, { pos: 0, size: MAX_DOCUMENT_BYTES + 1 }));
    if (data.byteLength > MAX_DOCUMENT_BYTES) return null;
    const mime = imageMime(data);
    if (!mime) return null;
    let binary = '';
    for (let i = 0; i < data.length; i += 8192) binary += String.fromCharCode(...data.subarray(i, i + 8192));
    return `data:${mime};base64,${btoa(binary)}`;
  } catch { return null; }
}

export async function openExternal(url: string): Promise<void> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error('无法打开此链接。'); }
  if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) throw new Error('仅支持网页和邮件链接。');
  if (isNative) await (await getNative()).os.open(parsed.href);
  else window.open(parsed.href, '_blank', 'noopener,noreferrer');
}

export async function printDocument(): Promise<void> {
  if (isNative) await (await getNative()).window.print();
  else window.print();
}

export async function saveHtml(name: string, html: string): Promise<void> {
  const fileName = name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') + '.html';
  if (isNative) {
    const native = await getNative();
    const path = await native.os.showSaveDialog('导出 HTML', {
      defaultPath: fileName,
      filters: [{ name: 'HTML', extensions: ['html'] }],
    });
    if (path) {
      if (DOCUMENT_EXTENSION.test(path)) throw new Error('导出文件请使用 .html 扩展名，避免覆盖原文。');
      await native.filesystem.writeFile(path, html);
    }
    return;
  }
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: fileName });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function loadPreference<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = isNative ? await (await getNative()).storage.getData(key) : localStorage.getItem(`liubai:${key}`);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch { return fallback; }
}

export async function savePreference(key: string, value: unknown): Promise<void> {
  if (isNative) await (await getNative()).storage.setData(key, JSON.stringify(value));
  else localStorage.setItem(`liubai:${key}`, JSON.stringify(value));
}
