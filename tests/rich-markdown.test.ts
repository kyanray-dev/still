// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseRichMarkdown, serializeRichMarkdown } from '../src/rich-markdown';

const names = (source: string) => { const found: string[] = []; parseRichMarkdown(source).descendants((node) => { found.push(node.type.name); }); return found; };

describe('visual Markdown document fidelity', () => {
  it('parses ordinary prose, images, nested lists and formatting into editable structures', () => {
    const source = '# 标题\n\n**强调**、*斜体*、~~删除~~、`code` 和 [链接](https://example.com)。\n\n- 一级\n  - 二级\n\n> 引用\n\n![描述](./图片.png "标题")';
    const doc = parseRichMarkdown(source);
    expect(names(source)).toEqual(expect.arrayContaining(['heading', 'paragraph', 'bullet_list', 'list_item', 'blockquote', 'image']));
    expect(names(source)).not.toContain('raw_block');
    const serialized = serializeRichMarkdown(doc);
    expect(serialized).toContain('**强调**');
    expect(serialized).toContain('~~删除~~');
    expect(serialized).toContain('![描述](');
    expect(parseRichMarkdown(serialized).toJSON()).toEqual(doc.toJSON());
  });

  it('preserves editable task completion, table alignment, escaped pipes and backslashes', () => {
    const source = '- [x] 完成\n- [ ] 待办\n\n| 项目 | 内容 |\n| :--- | ---: |\n| A \\| B | `C:\\path` |\n| 加粗 | **文字** |';
    const doc = parseRichMarkdown(source);
    expect(names(source)).toEqual(expect.arrayContaining(['table', 'table_row', 'table_header', 'table_cell']));
    expect(names(source)).not.toContain('raw_block');
    const serialized = serializeRichMarkdown(doc);
    expect(serialized).toContain('[x] 完成');
    expect(serialized).toContain('[ ] 待办');
    expect(serialized).toContain(':---');
    expect(serialized).toContain('---:');
    expect(parseRichMarkdown(serialized).toJSON()).toEqual(doc.toJSON());
  });

  it('preserves inline and block mathematics and editable footnotes through serialization', () => {
    const source = '# 公式 $x^2$\n\n正文 $x^2+y^2$ 和说明[^ref]。\n\n$$\n\\frac{1}{2}\n$$\n\n[^ref]: 注释 **重点**\n\n    第二段';
    const doc = parseRichMarkdown(source);
    expect(names(source)).toEqual(expect.arrayContaining(['math_inline', 'math_block', 'footnote_ref', 'footnote']));
    expect(names(source)).not.toContain('raw_block');
    const serialized = serializeRichMarkdown(doc);
    expect(serialized).toContain('$x^2+y^2$');
    expect(serialized).toContain('$$\n\\frac{1}{2}\n$$');
    expect(serialized).toContain('[^ref]: 注释 **重点**');
    expect(parseRichMarkdown(serialized).toJSON()).toEqual(doc.toJSON());
  });

  it('keeps raw HTML and unused definitions as original source rather than losing them', () => {
    const source = '<section onclick="alert(1)">原样 HTML</section>\n\n[unused]: https://example.com "说明"\n\n[^unused]: 尚未引用';
    const serialized = serializeRichMarkdown(parseRichMarkdown(source));
    expect(serialized).toContain('<section onclick="alert(1)">原样 HTML</section>');
    expect(serialized).toContain('[unused]: https://example.com "说明"');
    expect(serialized).toContain('[^unused]: 尚未引用');
  });

  it('does not duplicate reference-like syntax inside fenced or indented code', () => {
    const source = '```md\n[unused]: https://example.com\n[^note]: 代码中的说明\n```\n\n    [indented]: https://example.org\n\n正文';
    const doc = parseRichMarkdown(source);
    expect(names(source)).not.toContain('raw_block');
    const serialized = serializeRichMarkdown(doc);
    expect(serialized.match(/\[unused\]:/gu)).toHaveLength(1);
    expect(serialized.match(/\[\^note\]:/gu)).toHaveLength(1);
    expect(serialized.match(/\[indented\]:/gu)).toHaveLength(1);
  });

  it('preserves multiline unused definitions without duplicating literal paragraph syntax', () => {
    const source = '正文\n[literal]: /not-a-definition\n\n[empty]:\n\n[real]:\n  https://example.com\n  "保留标题"\n\n[^unused]: 首段\n\n    后续段落\n\n尾段';
    const serialized = serializeRichMarkdown(parseRichMarkdown(source));
    expect(serialized.match(/literal/gu)).toHaveLength(1);
    expect(serialized.match(/empty/gu)).toHaveLength(1);
    expect(serialized).toContain('[real]:\n  https://example.com\n  "保留标题"');
    expect(serialized).toContain('[^unused]: 首段\n\n    后续段落');
    expect(serialized).toContain('尾段');
  });
});
