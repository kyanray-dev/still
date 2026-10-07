import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const saveDialog = vi.fn();
const writeFile = vi.fn();
let ready: (() => void) | undefined;
vi.doMock('@neutralinojs/lib', () => ({
  init: () => ready?.(),
  events: { on: async (name: string, handler: () => void) => { if (name === 'ready') ready = handler; } },
  os: { showSaveDialog: saveDialog },
  filesystem: { writeFile },
}));

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('NL_MODE', 'window');
  saveDialog.mockReset();
  writeFile.mockReset();
  ready = undefined;
});
afterEach(() => vi.unstubAllGlobals());

describe('native HTML export protects source files', () => {
  it('writes the exact selected HTML destination', async () => {
    saveDialog.mockResolvedValue('C:/notes/export.html');
    const { saveHtml } = await import('../src/platform');
    await saveHtml('notes.md', '<html>notes</html>');
    expect(writeFile).toHaveBeenCalledWith('C:/notes/export.html', '<html>notes</html>');
  });
  it.each(['C:/notes/original.md', '/notes/Original.MARKDOWN', 'C:/notes/original.txt'])('never overwrites the source format %s', async path => {
    saveDialog.mockResolvedValue(path);
    const { saveHtml } = await import('../src/platform');
    await expect(saveHtml('notes.md', '<html>notes</html>')).rejects.toThrow('避免覆盖原文');
    expect(writeFile).not.toHaveBeenCalled();
  });
  it('does not write after the user cancels the save dialog', async () => {
    saveDialog.mockResolvedValue('');
    const { saveHtml } = await import('../src/platform');
    await saveHtml('notes.md', '<html>notes</html>');
    expect(writeFile).not.toHaveBeenCalled();
  });
});
