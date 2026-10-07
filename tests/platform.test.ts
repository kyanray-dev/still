import { describe, expect, it } from 'vitest';
import { decodeDocument, documentFromFile, scopedImagePath, MAX_DOCUMENT_BYTES } from '../src/platform';

describe('document decoding and limits', () => {
  it('reads UTF-8, Unicode and an optional BOM', () => {
    expect(decodeDocument(new TextEncoder().encode('\uFEFF# 留白\n中文 👋').buffer)).toBe('# 留白\n中文 👋');
  });
  it('reads UTF-16 with a byte order mark', () => {
    expect(decodeDocument(Uint8Array.from([255, 254, 0x59, 0x75, 0x7d, 0x76]).buffer)).toBe('留白');
    expect(decodeDocument(Uint8Array.from([254, 255, 0x75, 0x59, 0x76, 0x7d]).buffer)).toBe('留白');
  });
  it('rejects invalid UTF-8 instead of silently corrupting text', () => {
    expect(() => decodeDocument(Uint8Array.from([0xc0, 0xaf]).buffer)).toThrow('UTF-8');
  });
  it('rejects oversize documents before reading them', async () => {
    await expect(documentFromFile({ name: 'large.md', size: MAX_DOCUMENT_BYTES + 1 } as File)).rejects.toThrow('10 MB');
  });
  it('rejects executable and binary file extensions', async () => {
    await expect(documentFromFile({ name: 'app.exe', size: 2 } as File)).rejects.toThrow('Markdown');
  });
});

describe('relative image boundaries', () => {
  it('supports Windows and Mac paths with spaces and Chinese', () => {
    expect(scopedImagePath('./图片/阅读%20图.png', 'C:\\文章\\笔记.md')).toBe('C:/文章/图片/阅读 图.png');
    expect(scopedImagePath('images/photo.jpg', '/Users/person/notes/readme.md')).toBe('/Users/person/notes/images/photo.jpg');
    expect(scopedImagePath('images/../photo.gif', '/notes/a.md')).toBe('/notes/photo.gif');
  });
  it.each(['../secret.png', '%2e%2e/secret.png', 'a/../../secret.png', '/secret.png', '\\\\server\\file.png', 'C:\\secret.png', 'file:///secret.png', 'https://example.org/pixel.png', '//example.org/pixel.png', 'data:image/png,AAA', 'a%00.png', 'test.svg', 'foo.png.exe'])('rejects %s', source => {
    expect(scopedImagePath(source, '/notes/file.md')).toBeNull();
  });
});
