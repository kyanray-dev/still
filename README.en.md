# Still · 留白

A quiet, lightweight Markdown editor and reader. Write directly in the formatted document and save ordinary Markdown files.

[简体中文](README.md) · [Releases](https://github.com/kyanray-dev/still/releases/latest) · [License](LICENSE)

![Direct document editing in Still](docs/images/wysiwyg-light.png)

Still uses the system WebView without bundling a browser. No account is required. Documents are processed locally and the app does not upload their contents. Current version: **1.2.0**. The interface currently uses Chinese labels.

## Get started

| Platform | Requirements | Open the app |
| --- | --- | --- |
| Windows x64 | Windows 10 / 11 and Microsoft Edge WebView2 Runtime | Extract all of `Still-1.2.0-Windows-x64.zip`, open `Still.exe`, and keep `resources.neu` beside it |
| macOS universal | macOS 13+, Safari / system WebKit 16.4+; Apple Silicon or Intel | Extract `Still-1.2.0-macOS-universal.zip` and move `留白.app` to Applications |

Check the [release page](https://github.com/kyanray-dev/still/releases/latest) for available packages and checksums, or build from source below. Keep macOS and Safari updated; the minimum WebKit version is needed for [regular expression support](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/) used by the editor.

**Current packages are unsigned. The macOS package is not notarized and has not been tested on a physical Mac.** Native WebView2 and Chromium/WebKit interface tests have run on Windows. A GitHub macOS runner passed 86 unit tests, 42 WebKit interface tests, and build/packaging checks; native macOS application interactions remain unverified. If your system blocks launch, verify the download's origin before using the system's option to allow it.

## Write on the page

Choose **Edit (编辑)** to work directly with headings, paragraphs, quotes, lists, and tables in a single document canvas. New documents open in visual editing mode, with no split preview.

- Type `# `, `## `, `- `, `1. `, or `> ` at the start of a line to apply that format.
- Select text and use the toolbar or shortcuts for bold, italic, links, and code.
- Edit table cells directly and use Tab to move to the next cell. Click task checkboxes to update them.
- Formulas and special fragments offer an inline Edit control. Changes enter the draft immediately; Done collapses their source.
- The `</>` button switches between visual and source editing. **More → View source (更多 → 查看源文)** is a separate, read-only inspection mode.

Other features include multiple documents, drag and drop, an automatic outline, reading progress, in-document search, light/paper/dark themes, system appearance, and adjustable type and page width. Code highlighting and copying, math, footnotes, tables, standalone HTML export, and system printing/PDF are included.

Visual editing preserves Markdown content and structure, but saving changes may normalize blank lines, list markers, or reference links. Use source editing when exact markup matters. Each mode has its own undo history: switching alone preserves history, while edits in the other mode load new content and begin a new history on return. Drafts, undo history, and selections are independent for each document.

## Saving and drafts

- **Edits are not saved to disk automatically.** Use Save or its shortcut. Switching documents keeps their drafts in memory.
- Closing or reloading an unsaved document, or closing the window, prompts to save. If the file has changed outside the app, saving offers Save As, overwrite, or cancel.
- The desktop app writes a temporary file in the original directory, reads it back for verification, then replaces the destination. Saved files use UTF-8; editor line endings use LF.
- There is no background crash recovery. Forced termination or power loss can discard unsaved drafts. System quit paths, including Quit from the macOS Dock, may bypass the window-close prompt; save before quitting.
- The browser development preview saves by downloading an `.md` file. It shows a Downloaded status and does not overwrite the local file originally selected.

## Shortcuts

| Action | Windows | macOS |
| --- | --- | --- |
| Open / New | Ctrl + O / N | ⌘ + O / N |
| Edit / Read | Ctrl + E | ⌘ + E |
| Save / Save As | Ctrl + S / Ctrl + Shift + S | ⌘ + S / ⌘ + Shift + S |
| Undo / Redo | Ctrl + Z / Ctrl + Shift + Z | ⌘ + Z / ⌘ + Shift + Z |
| Bold / Italic / Link | Ctrl + B / I / K | ⌘ + B / I / K |
| Find | Ctrl + F | ⌘ + F |
| Previous / Next match | Shift + Enter / Enter | Shift + Enter / Enter |
| Toggle sidebar | Ctrl + \ | ⌘ + \ |
| Read-only source / Read | Ctrl + Shift + M | ⌘ + Shift + M |
| Print | Ctrl + P | ⌘ + P |
| Close search or settings | Esc | Esc |

## Files and privacy

Supported extensions: `.md`, `.markdown`, `.mdown`, `.mkd`, and `.txt`. Supported encodings: UTF-8 and UTF-16 with a BOM. Each document or local image is limited to 10 MiB. Unsupported encodings prompt for conversion to UTF-8.

The desktop app supports relative PNG, JPEG, GIF, WebP, and BMP images in the document's directory or its children, plus relative Markdown document links. Local SVG files, absolute image paths, and image paths escaping to a parent directory are blocked. Symbolic links follow system resolution, so path checks are not an operating-system sandbox. The browser preview cannot read neighboring images because of browser file permissions.

Local files work offline. Remote HTTPS images need a network connection and make requests to their hosts. Exported HTML embeds resolved local images and math fonts; remote images may still require a connection.

Raw HTML, scripts, and Mermaid diagrams are not executed. Rendered Markdown is sanitized. Complex fragments keep their source and remain editable; math, footnotes, tables, and task states survive a visual-editing Markdown round trip.

Search matches displayed text across inline formatting, but not across paragraphs or inside formula markup. Up to 5,000 matches are highlighted. Recent file paths and reading preferences are stored locally. Clearing recent files does not delete the files themselves.

## Development and builds

Use Node.js **22.22.2+ (22.x) or 24.15+ (24.x)**. Dependencies are pinned in `package-lock.json`.

```sh
npm ci
npm run dev
```

Open the local URL printed in the terminal. For desktop development, download the runtime and build the resources first:

```sh
npm run native:update
npm run build:web
npm run native:run
```

Build distribution packages:

```sh
npm run native:update
npm run build
npm run package
```

`release/` contains Windows x64 and macOS universal ZIP files and SHA-256 checksums. `bin/`, `dist-web/`, and `dist-native/` are generated directories. Icon sources and generation scripts are included; normal builds need no extra graphics dependencies.

## Tests

```sh
npm test
npx playwright install chromium webkit
npm run test:e2e
```

Local Windows runs use installed Edge by default. Set `PLAYWRIGHT_CHANNEL=chromium` to use Playwright Chromium, or `PLAYWRIGHT_BROWSER=webkit` for the WebKit suite. In PowerShell, use `$env:PLAYWRIGHT_BROWSER='webkit'`.

After building, run the native integration tests on Windows:

```sh
node scripts/test-native.mjs
```

These tests launch real, hidden desktop windows and verify the UI and file saving through WebView2. Native file drops use simulated framework events, and text composition uses automated events. System IMEs, file-picker gestures, print dialogs, and physical Mac interactions are outside the completed automated validation. Tests use a dedicated data directory and restore earlier settings and recent files afterward.

The [build workflow](.github/workflows/build.yml) defines Windows/macOS builds and tests. Check the repository's Actions history for remote execution results.

Known validation limitation: the [hosted Windows native check](https://github.com/kyanray-dev/still/actions/runs/37602324943) times out while connecting to the desktop debugging endpoint and has not passed. Unit tests, browser interface tests, and the build passed in that run. All 21 real WebView2 checks passed on the local Windows machine. The hosted timeout remains unexplained; the failing check has not been skipped or marked successful.

## Built with and license

TypeScript, Vite, and [Neutralinojs](https://neutralino.js.org/docs/). ProseMirror handles visual editing and CodeMirror 6 handles source editing. markdown-it parses Markdown, DOMPurify sanitizes it, and highlight.js and KaTeX render code and math. The interface uses system fonts and original SVG icons.

The project's **original code is licensed under [0BSD](LICENSE)**. Third-party components, runtimes, and fonts retain their respective licenses; they are not relicensed under 0BSD. See [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt) and [licenses/](licenses/).
