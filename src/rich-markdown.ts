import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import { katex } from '@mdit/plugin-katex';
import { Schema, type Node as ProseNode } from 'prosemirror-model';
import { schema as markdownSchema, defaultMarkdownParser, defaultMarkdownSerializer, MarkdownParser, MarkdownSerializer } from 'prosemirror-markdown';
import { tableNodes } from 'prosemirror-tables';
import { isSafeUrl } from './markdown';

let nodes = markdownSchema.spec.nodes
  .update('heading', { ...markdownSchema.spec.nodes.get('heading')!, content: 'inline*' })
  .update('list_item', {
    ...markdownSchema.spec.nodes.get('list_item')!,
    content: 'paragraph block*',
    attrs: { checked: { default: null } },
    parseDOM: [{ tag: 'li', getAttrs: (dom) => ({ checked: dom.hasAttribute('data-checked') ? dom.getAttribute('data-checked') === 'true' : null }) }],
    toDOM: (node) => ['li', node.attrs.checked === null ? {} : { 'data-checked': String(node.attrs.checked), class: 'task-list-item' }, 0],
  })
  .update('image', {
    ...markdownSchema.spec.nodes.get('image')!,
    parseDOM: [{ tag: 'img[src]', getAttrs: (dom) => {
      const src = dom.getAttribute('src') || '';
      return isSafeUrl(src) ? { src, alt: dom.getAttribute('alt'), title: dom.getAttribute('title') } : false;
    } }],
    toDOM: (node) => ['img', { src: /^https?:\/\//iu.test(node.attrs.src) ? node.attrs.src : undefined, alt: node.attrs.alt || '', title: node.attrs.title || undefined, 'data-local-src': node.attrs.src, referrerpolicy: 'no-referrer' }],
  });

nodes = nodes.append(tableNodes({ tableGroup: 'block', cellContent: 'paragraph', cellAttributes: {
  align: { default: null, getFromDOM: (dom) => dom.style.textAlign || null, setDOMAttr: (value, attrs) => { if (value) attrs.style = `text-align:${value}`; } },
} })).append({
  math_inline: { inline: true, group: 'inline', atom: true, attrs: { source: {} }, toDOM: (node) => ['span', { class: 'rich-math-inline', 'data-source': node.attrs.source }, node.attrs.source] },
  math_block: { group: 'block', atom: true, attrs: { source: {} }, toDOM: (node) => ['div', { class: 'rich-math-block', 'data-source': node.attrs.source }, node.attrs.source] },
  raw_inline: { inline: true, group: 'inline', atom: true, attrs: { source: {} }, toDOM: (node) => ['span', { class: 'rich-raw-inline' }, node.attrs.source] },
  raw_block: { group: 'block', atom: true, attrs: { source: {} }, toDOM: (node) => ['div', { class: 'rich-raw-block' }, node.attrs.source] },
  footnote_ref: { inline: true, group: 'inline', atom: true, attrs: { label: {} }, toDOM: (node) => ['sup', { class: 'rich-footnote-ref', contenteditable: 'false' }, `[${node.attrs.label}]`] },
  footnote: { group: 'block', content: 'block+', defining: true, attrs: { label: {} }, toDOM: (node) => ['div', { class: 'rich-footnote', 'data-label': node.attrs.label }, 0] },
});

const marks = markdownSchema.spec.marks
  .update('link', {
    ...markdownSchema.spec.marks.get('link')!,
    parseDOM: [{ tag: 'a[href]', getAttrs: (dom) => { const href = dom.getAttribute('href') || ''; return isSafeUrl(href) ? { href, title: dom.getAttribute('title') } : false; } }],
    toDOM: (mark) => ['a', { href: isSafeUrl(mark.attrs.href) ? mark.attrs.href : undefined, title: mark.attrs.title || undefined, rel: 'noopener noreferrer' }, 0],
  })
  .append({ strike: { parseDOM: [{ tag: 's' }, { tag: 'del' }], toDOM: () => ['s', 0] } });

export const richSchema = new Schema({ nodes, marks });
const tokenizer = new MarkdownIt({ html: true, linkify: false }).use(footnote).use(katex, { trust: false, throwOnError: false });
tokenizer.validateLink = isSafeUrl;

tokenizer.core.ruler.push('editable_structure', (state) => {
  const output: typeof state.tokens = [];
  const footnotes = new Set<string>();
  const literalLines = new Set<number>();
  for (let index = 0; index < state.tokens.length; index += 1) {
    const token = state.tokens[index];
    if (token.map && ['inline', 'fence', 'code_block', 'html_block', 'math_block'].includes(token.type)) {
      for (let line = token.map[0]; line < token.map[1]; line += 1) literalLines.add(line);
    }
    if (token.type === 'list_item_open') {
      const inline = state.tokens[index + 2];
      const first = inline?.type === 'inline' ? inline.children?.[0] : undefined;
      const task = first?.type === 'text' ? first.content.match(/^\[([ xX])\]\s+/u) : null;
      if (task && first) {
        token.meta = { checked: task[1].toLowerCase() === 'x' };
        first.content = first.content.slice(task[0].length);
      }
    }
    if (token.type === 'footnote_open') footnotes.add(String(token.meta?.label ?? Number(token.meta?.id) + 1));
    if (token.type === 'th_close' || token.type === 'td_close') output.push(new state.Token('paragraph_close', 'p', -1));
    output.push(token);
    if (token.type === 'th_open' || token.type === 'td_open') output.push(new state.Token('paragraph_open', 'p', 1));
  }
  // Reference definitions that the parser otherwise consumes remain available
  // for future source edits, including currently unused footnote definitions.
  const lines = state.src.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const definition = lines[index].match(/^ {0,3}\[([^\]]+)\]:\s*/u);
    if (!definition || literalLines.has(index) || (definition[1].startsWith('^') && footnotes.has(definition[1].slice(1)))) continue;
    const collected = [lines[index]];
    while (index + 1 < lines.length && !literalLines.has(index + 1) && !/^ {0,3}\[[^\]]+\]:/u.test(lines[index + 1])) collected.push(lines[++index]);
    const token = new state.Token('preserved_definition', '', 0);
    token.content = collected.join('\n').trimEnd();
    output.push(token);
  }
  state.tokens = output;
});

const parser = new MarkdownParser(richSchema, tokenizer, {
  ...defaultMarkdownParser.tokens,
  list_item: { block: 'list_item', getAttrs: (token) => ({ checked: token.meta?.checked ?? null }) },
  s: { mark: 'strike' },
  table: { block: 'table' }, thead: { ignore: true }, tbody: { ignore: true }, tr: { block: 'table_row' },
  th: { block: 'table_header', getAttrs: (token) => ({ align: token.attrGet('style')?.replace(/^text-align:/u, '') || null }) },
  td: { block: 'table_cell', getAttrs: (token) => ({ align: token.attrGet('style')?.replace(/^text-align:/u, '') || null }) },
  math_inline: { node: 'math_inline', getAttrs: (token) => ({ source: `$${token.content}$` }) },
  math_block: { node: 'math_block', getAttrs: (token) => ({ source: `$$\n${token.content.trimEnd()}\n$$` }) },
  html_inline: { node: 'raw_inline', getAttrs: (token) => ({ source: token.content }) },
  html_block: { node: 'raw_block', getAttrs: (token) => ({ source: token.content.trimEnd() }) },
  preserved_definition: { node: 'raw_block', getAttrs: (token) => ({ source: token.content }) },
  footnote_ref: { node: 'footnote_ref', getAttrs: (token) => ({ label: String(token.meta.label ?? token.meta.id + 1) }) },
  footnote_block: { ignore: true },
  footnote: { block: 'footnote', getAttrs: (token) => ({ label: String(token.meta.label ?? token.meta.id + 1) }) },
  footnote_anchor: { ignore: true, noCloseToken: true },
});

export const richSerializer = new MarkdownSerializer({
  ...defaultMarkdownSerializer.nodes,
  list_item(state, node) { if (node.attrs.checked !== null) state.write(node.attrs.checked ? '[x] ' : '[ ] '); state.renderContent(node); },
  math_inline(state, node) { state.write(node.attrs.source); },
  math_block(state, node) { state.write(node.attrs.source); state.closeBlock(node); },
  raw_inline(state, node) { state.write(node.attrs.source); },
  raw_block(state, node) { state.write(node.attrs.source); state.closeBlock(node); },
  footnote_ref(state, node) { state.write(`[^${node.attrs.label}]`); },
  footnote(state, node) { state.wrapBlock('    ', `[^${node.attrs.label}]: `, node, () => state.renderContent(node)); },
  table(state, node) {
    node.forEach((row, _offset, index) => {
      const cells: string[] = [];
      row.forEach((cell) => {
        const value = richSerializer.serialize(cell).replace(/\n+/gu, ' ').replace(/(?<!\\)\|/gu, '\\|');
        cells.push(value);
      });
      state.write(`| ${cells.join(' | ')} |\n`);
      if (index === 0) {
        const separators: string[] = [];
        row.forEach((cell) => separators.push(cell.attrs.align === 'center' ? ':---:' : cell.attrs.align === 'right' ? '---:' : cell.attrs.align === 'left' ? ':---' : '---'));
        state.write(`| ${separators.join(' | ')} |\n`);
      }
    });
    state.closeBlock(node);
  },
  table_row() { throw new Error('Table rows must remain inside their table.'); },
  table_cell(state, node) { state.renderContent(node); },
  table_header(state, node) { state.renderContent(node); },
}, {
  ...defaultMarkdownSerializer.marks,
  strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
});

export function parseRichMarkdown(source: string): ProseNode {
  try {
    const doc = parser.parse(source.replace(/^\uFEFF/u, ''));
    doc.check();
    return doc;
  } catch {
    // An unsupported extension remains editable as original text, never omitted.
    return richSchema.nodes.doc.create(null, [richSchema.nodes.raw_block.create({ source }), richSchema.nodes.paragraph.create()]);
  }
}

export function serializeRichMarkdown(doc: ProseNode): string {
  return richSerializer.serialize(doc);
}
