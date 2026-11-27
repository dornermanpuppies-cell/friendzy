// Declared locally: this project does not ship Node type definitions to the app sources, and the
// check has to read files because the fault is a prop missing on one platform.
declare const require: (id: string) => unknown;
declare const __dirname: string;

type Dirent = { name: string; isDirectory(): boolean; isFile(): boolean };
const fs = require('node:fs') as {
  readdirSync(dir: string, options: { withFileTypes: true }): Dirent[];
  readFileSync(file: string, encoding: 'utf8'): string;
};
const path = require('node:path') as { join(...parts: string[]): string; relative(from: string, to: string): string };

/**
 * Guards the fix for "the keyboard covers what I am typing" on Android.
 *
 * Android apps have been edge-to-edge since Expo SDK 54, so the window no longer shrinks when the
 * keyboard opens. `behavior={Platform.OS === 'ios' ? 'padding' : undefined}` used to be the correct
 * line and is now a no-op on Android: the composer, the comment bar and submit buttons end up
 * underneath the keys. Expo's keyboard guide says to set a behavior on both platforms.
 *
 * These tests read the source rather than render, because the fault is a prop that is missing on one
 * platform; a render test under jest-expo would pass on either setting.
 */
const root = path.join(__dirname, '..', '..', '..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry: Dirent) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe('keyboard handling', () => {
  const files = sourceFiles(root);

  it('never leaves a KeyboardAvoidingView without a behavior on Android', () => {
    const offenders = files.filter((file) => {
      const text = fs.readFileSync(file, 'utf8');
      if (!text.includes('KeyboardAvoidingView')) return false;
      // Any shape of "undefined on Android": the window will not resize, so nothing happens there.
      return /behavior=\{[^}]*android:\s*undefined[^}]*\}/.test(text) || /behavior=\{[^}]*'ios'\s*\?\s*'padding'\s*:\s*undefined[^}]*\}/.test(text);
    });
    expect(offenders.map((f) => path.relative(root, f))).toEqual([]);
  });

  it('gives every KeyboardAvoidingView an explicit behavior', () => {
    const missing = files.filter((file) => {
      const text = fs.readFileSync(file, 'utf8');
      const opens = text.match(/<KeyboardAvoidingView[^>]*>/gs) ?? [];
      return opens.some((tag: string) => !tag.includes('behavior'));
    });
    expect(missing.map((f) => path.relative(root, f))).toEqual([]);
  });

  it('keeps the shared Screen footer inside the keyboard avoider', () => {
    // A footer rendered after the avoider holds submit buttons and comment bars under the keyboard.
    const text = fs.readFileSync(path.join(root, 'components', 'ui', 'Screen.tsx'), 'utf8');
    const avoider = text.slice(text.indexOf('<KeyboardAvoidingView'), text.indexOf('</KeyboardAvoidingView>'));
    expect(avoider).toContain('{footer}');
  });

  it('lets the chat list dismiss the keyboard when you drag it', () => {
    const text = fs.readFileSync(path.join(root, 'app', '(app)', 'chat', '[id]', 'index.tsx'), 'utf8');
    expect(text).toMatch(/keyboardDismissMode=/);
  });

  it('lifts the absolutely positioned live chat box by the keyboard height', () => {
    // KeyboardAvoidingView cannot move an absolutely positioned child, so the live room reads the
    // keyboard height itself.
    const text = fs.readFileSync(path.join(root, 'features', 'live', 'LiveRoom.tsx'), 'utf8');
    expect(text).toContain('useKeyboardInset');
    expect(text).toMatch(/bottom:\s*chatBottom/);
  });
});
