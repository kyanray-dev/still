// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { countWords, isSafeUrl, renderMarkdown } from '../src/markdown';

function fragment(source: string): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = renderMarkdown(source).html;
  return container;
}

describe('document structure', () => {
  it('creates stable Unicode heading IDs, preserves plain titles and prevents collisions', () => {
    const source = '# 春天的 **笔记**\n## 春天的 笔记\n## 春天的 笔记-2\n# `location`\n# 🌱';
    const first = renderMarkdown(source);
    expect(first.headings).toEqual([
      { id: 'heading-春天的-笔记', text: '春天的 笔记', level: 1 },
      { id: 'heading-春天的-笔记-2', text: '春天的 笔记', level: 2 },
      { id: 'heading-春天的-笔记-2-2', text: '春天的 笔记-2', level: 2 },
      { id: 'heading-location', text: 'location', level: 1 },
      { id: 'heading-section', text: '🌱', level: 1 },
    ]);
    expect(renderMarkdown(source).headings).toEqual(first.headings);
    expect(new Set(first.headings.map((heading) => heading.id)).size).toBe(5);
    expect(fragment(source).querySelector('#heading-location')).not.toBeNull();
  });

  it('rewrites document fragments and retains footnote navigation', () => {
    const page = fragment('# 标题\n[跳转](#标题)\n\n正文[^1]\n\n[^1]: 解释');
    expect(page.querySelector('a')?.getAttribute('href')).toBe('#heading-标题');
    expect(page.querySelector('.footnote-ref a')?.getAttribute('href')).toBe('#fn1');
    expect(page.querySelector('#fn1')).not.toBeNull();
  });

  it('supports tables, nested task lists, quotes, images and strike-through', () => {
    const page = fragment('| 项目 | 状态 |\n| --- | --- |\n| 文档 | 完成 |\n\n- [x] 已完成\n- [ ] 待完成\n  - 嵌套条目\n\n> 保持简单\n\n~~旧文字~~\n\n![描述](./图片.png)');
    expect(page.querySelectorAll('td')).toHaveLength(2);
    const checkboxes = [...page.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes.every((checkbox) => checkbox.disabled)).toBe(true);
    expect(checkboxes.map((checkbox) => checkbox.checked)).toEqual([true, false]);
    expect(page.querySelector('blockquote')?.textContent).toContain('保持简单');
    expect(page.querySelector('s')?.textContent).toBe('旧文字');
    expect(page.querySelector('img')?.getAttribute('data-local-src')).toContain('%E5%9B%BE%E7%89%87.png');
    expect(page.querySelector('img')?.getAttribute('alt')).toBe('描述');
  });

  it('highlights known languages and gives unknown code a safe readable fallback', () => {
    const page = fragment('```js\nconst x = "<script>";\n```\n\n```unknown\n<a href="danger">text</a>\n```');
    expect(page.querySelectorAll('[data-copy-code]')).toHaveLength(2);
    expect(page.querySelectorAll('pre code')).toHaveLength(2);
    expect(page.querySelector('.hljs-keyword')?.textContent).toBe('const');
    expect(page.querySelectorAll('pre code')[1].textContent).toBe('<a href="danger">text</a>\n');
    expect(page.querySelector('pre a')).toBeNull();
  });

  it('renders math with accessible MathML and rejects trusted HTML extensions', () => {
    const page = fragment('公式 $E=mc^2$\n\n$$\n\\frac{1}{2}\n$$\n\n$\\href{javascript:alert(1)}{x}$');
    expect(page.querySelectorAll('.katex')).toHaveLength(3);
    expect(page.querySelector('math')).not.toBeNull();
    expect(page.querySelector('.katex-display')).not.toBeNull();
    expect(page.querySelector('a[href^="javascript:"]')).toBeNull();
  });
});

describe('untrusted document safety', () => {
  it('displays raw HTML without creating active elements', () => {
    const page = fragment('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<iframe src="https://example.com"></iframe>');
    expect(page.querySelector('script, img, iframe')).toBeNull();
    expect(page.textContent).toContain('<script>alert(1)</script>');
  });

  it('never creates script, file, data or custom-protocol links', () => {
    const page = fragment('[a](javascript:alert%281%29)\n[b](JaVaScRiPt:alert%281%29)\n[c](data:text/html,hello)\n[d](file:///etc/passwd)\n[e](shell:open)\n[f](java&#x73;cript:alert%281%29)\n[g](https://example.com)');
    const links = [...page.querySelectorAll('a')];
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('https://example.com');
    expect(links[0].getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('escapes code language labels and malformed image metadata', () => {
    const page = fragment('```<img/src=x/onerror=alert(1)>\nx\n```\n\n![" onerror="alert(1)](https://example.com/image.png "safe title")');
    expect(page.querySelectorAll('img')).toHaveLength(1);
    expect(page.querySelector('[onerror]')).toBeNull();
    expect(page.querySelector('.code-language')?.textContent).toBe('<img/src=x/onerror=alert(1)>');
    expect(page.querySelector('img')?.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it.each(['javascript:alert(1)', 'data:image/svg+xml,x', 'file:///private/a', 'shell:run', '\\host\\file', 'https://example.com/\u0000'])('rejects unsafe URL %s', (value) => {
    expect(isSafeUrl(value)).toBe(false);
  });

  it.each(['https://example.com', 'http://example.com/a', './images/a.png', '../a.md', '#标题', 'mailto:a@example.com'])('accepts supported URL %s', (value) => {
    expect(isSafeUrl(value)).toBe(true);
  });
});

describe('reading statistics', () => {
  it('counts CJK characters and other words without counting punctuation', () => {
    expect(countWords('你好，世界！ Hello, world.')).toBe(6);
    expect(countWords('读书 reading Markdown 2026')).toBe(5);
    expect(countWords('こんにちは 한국어')).toBe(8);
    expect(countWords('   🌱 — ')).toBe(0);
  });

  it('does not count Markdown punctuation, destination URLs or rendered formula duplicates', () => {
    expect(renderMarkdown('# 你好\n\n[hello](https://long.example.com/lots/of/words)').wordCount).toBe(3);
    expect(renderMarkdown('').readingMinutes).toBe(0);
    expect(renderMarkdown('一').readingMinutes).toBe(1);
    expect(renderMarkdown('字'.repeat(801)).readingMinutes).toBe(3);
  });
});
