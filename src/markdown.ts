import MarkdownIt from 'markdown-it';
import type { Env, Token } from 'markdown-it';
import footnote from 'markdown-it-footnote';
// @ts-expect-error The task-list plugin does not publish TypeScript declarations.
import taskLists from 'markdown-it-task-lists';
import DOMPurify from 'dompurify';
import { katex } from '@mdit/plugin-katex';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import sql from 'highlight.js/lib/languages/sql';
import yaml from 'highlight.js/lib/languages/yaml';
import rust from 'highlight.js/lib/languages/rust';
import cpp from 'highlight.js/lib/languages/cpp';
import markdown from 'highlight.js/lib/languages/markdown';

for (const [name, language] of Object.entries({ javascript, typescript, python, bash, json, css, xml, sql, yaml, rust, cpp, markdown })) {
  hljs.registerLanguage(name, language);
}

export interface Heading {
  id: string;
  text: string;
  level: number;
}

export interface RenderedMarkdown {
  html: string;
  headings: Heading[];
  wordCount: number;
  readingMinutes: number;
}

interface RenderEnvironment extends Env {
  anchors: Map<string, string>;
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: false,
})
  .use(footnote)
  .use(taskLists, { enabled: false, label: false })
  .use(katex, { trust: false, throwOnError: false, strict: 'ignore', maxExpand: 1000, maxSize: 20 });

/** Only web, email, phone and relative URLs may become active document links. */
export function isSafeUrl(value: string): boolean {
  const normalized = value.trim();
  if (/[\u0000-\u001f\u007f]/u.test(normalized)) return false;
  if (/^[\\]/u.test(normalized)) return false;
  const scheme = normalized.match(/^([a-z][a-z0-9+.-]*):/iu)?.[1]?.toLowerCase();
  return scheme === undefined || ['http', 'https', 'mailto', 'tel'].includes(scheme);
}

md.validateLink = isSafeUrl;

function inlineText(tokens: Token[]): string {
  return tokens.map((token) => {
    if (token.type === 'softbreak' || token.type === 'hardbreak') return ' ';
    if (token.children) return inlineText(token.children);
    if (['text', 'code_inline', 'math_inline', 'image'].includes(token.type)) return token.content;
    return '';
  }).join('');
}

function slugify(text: string): string {
  return text.normalize('NFKC').toLowerCase().trim()
    .replace(/[^\p{Letter}\p{Number}\p{Mark}\s_-]/gu, '')
    .replace(/[\s_]+/gu, '-')
    .replace(/^-+|-+$/gu, '') || 'section';
}

const originalLinkOpen = md.renderer.rules.link_open;
md.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  const token = tokens[index];
  const href = String(token.attrGet('href') || '');
  if (href.startsWith('#')) {
    let anchor = href.slice(1);
    try { anchor = decodeURIComponent(anchor); } catch { /* Keep malformed fragments inert. */ }
    const anchors = (env as RenderEnvironment | undefined)?.anchors;
    const mapped = anchors?.get(anchor) ?? anchors?.get(slugify(anchor));
    if (mapped) token.attrSet('href', `#${mapped}`);
  } else {
    token.attrSet('rel', 'noopener noreferrer');
  }
  return originalLinkOpen?.(tokens, index, options, env, renderer) ?? renderer.renderToken(tokens, index, options);
};

const originalImage = md.renderer.rules.image!;
md.renderer.rules.image = (tokens, index, options, env, renderer) => {
  const token = tokens[index];
  const source = String(token.attrGet('src') || '');
  if (!isSafeUrl(source) || /^(?:mailto|tel):/iu.test(source)) {
    return md.utils.escapeHtml(inlineText(token.children || []));
  }
  token.attrSet('loading', 'lazy');
  token.attrSet('decoding', 'async');
  token.attrSet('referrerpolicy', 'no-referrer');
  if (!/^(?:https?:)?\/\//iu.test(source)) token.attrSet('data-local-src', source);
  return originalImage(tokens, index, options, env, renderer);
};

md.renderer.rules.fence = (tokens, index) => {
  const token = tokens[index];
  const language = token.info.trim().split(/\s+/u)[0] || 'text';
  let highlighted = md.utils.escapeHtml(token.content);
  // Very large code blocks stay plain text to keep reading responsive.
  if (token.content.length < 100_000 && hljs.getLanguage(language)) {
    try { highlighted = hljs.highlight(token.content, { language, ignoreIllegals: true }).value; } catch { /* Plain text is always a readable fallback. */ }
  }
  const safeLanguage = md.utils.escapeHtml(language);
  const languageClass = /^[\w+-]+$/u.test(language) ? ` language-${safeLanguage}` : '';
  return `<div class="code-block"><div class="code-toolbar"><span class="code-language">${safeLanguage}</span><button class="copy-code" type="button" data-copy-code aria-label="复制代码">复制</button></div><pre><code class="hljs${languageClass}">${highlighted}</code></pre></div>\n`;
};

/** Chinese, Japanese and Korean characters count individually; other scripts count by word. */
export function countWords(text: string): number {
  const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
  const characterCount = [...text.matchAll(cjk)].length;
  const remaining = text.replace(cjk, ' ');
  const wordCount = remaining.match(/[\p{Letter}\p{Number}]+(?:['’\-][\p{Letter}\p{Number}]+)*/gu)?.length || 0;
  return characterCount + wordCount;
}

export function renderMarkdown(source: string): RenderedMarkdown {
  const env: RenderEnvironment = { anchors: new Map() };
  const tokens = md.parse(source.replace(/^\uFEFF/u, ''), env);
  const headings: Heading[] = [];
  const identifiers = new Set<string>();
  const readable: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === 'heading_open') {
      const text = inlineText(tokens[index + 1]?.children || []).trim();
      const slug = slugify(text);
      let uniqueSlug = slug;
      let suffix = 2;
      while (identifiers.has(`heading-${uniqueSlug}`)) uniqueSlug = `${slug}-${suffix++}`;
      const id = `heading-${uniqueSlug}`;
      identifiers.add(id);
      // The prefix prevents named DOM properties from colliding with application globals.
      token.attrSet('id', id);
      headings.push({ id, text, level: Number(token.tag.slice(1)) });
      if (!env.anchors.has(slug)) env.anchors.set(slug, id);
      if (!env.anchors.has(uniqueSlug)) env.anchors.set(uniqueSlug, id);
      env.anchors.set(id, id);
    }
    if (token.type === 'inline') readable.push(inlineText(token.children || []));
    else if (['fence', 'code_block', 'math_block'].includes(token.type)) readable.push(token.content);
  }

  const rendered = md.renderer.render(tokens, md.options, env);
  const html = DOMPurify.sanitize(rendered, {
    USE_PROFILES: { html: true, svg: true, mathMl: true },
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form'],
    ADD_ATTR: ['data-copy-code', 'data-local-src', 'loading', 'decoding', 'referrerpolicy'],
  });
  const wordCount = countWords(readable.join(' '));
  return { html, headings, wordCount, readingMinutes: wordCount ? Math.max(1, Math.ceil(wordCount / 400)) : 0 };
}
