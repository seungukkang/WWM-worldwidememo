import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface Entry {
  message: string;
  placeholders?: Record<string, { content: string }>;
}
type Messages = Record<string, Entry>;

const root = join(__dirname, '..');
const localesDir = join(root, 'src', '_locales');
const load = (lang: string): Messages =>
  JSON.parse(readFileSync(join(localesDir, lang, 'messages.json'), 'utf8')) as Messages;

const en = load('en');
const locales = readdirSync(localesDir);

describe('i18n catalogs', () => {
  it('ships en (default) and ko', () => {
    expect(locales).toEqual(expect.arrayContaining(['en', 'ko']));
  });

  for (const lang of locales) {
    describe(lang, () => {
      const msgs = load(lang);

      it('has exactly the same keys as en', () => {
        expect(Object.keys(msgs).sort()).toEqual(Object.keys(en).sort());
      });

      it('uses the same placeholders as en', () => {
        for (const [key, entry] of Object.entries(msgs)) {
          const expected = Object.keys(en[key]?.placeholders ?? {}).sort();
          expect(Object.keys(entry.placeholders ?? {}).sort(), key).toEqual(expected);
          for (const name of expected) expect(entry.message, key).toContain(`$${name}$`);
        }
      });

      it('respects Chrome Web Store length limits', () => {
        expect(msgs.extName!.message.length).toBeLessThanOrEqual(75);
        expect(msgs.extShortName!.message.length).toBeLessThanOrEqual(12);
        expect(msgs.extDescription!.message.length).toBeLessThanOrEqual(132);
      });

      it('has no empty messages', () => {
        for (const [key, entry] of Object.entries(msgs)) expect(entry.message.trim(), key).not.toBe('');
      });
    });
  }

  it('every __MSG_x__ in manifest.json exists', () => {
    const manifest = readFileSync(join(root, 'src', 'manifest.json'), 'utf8');
    const keys = [...manifest.matchAll(/__MSG_(\w+)__/g)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(en, k).toHaveProperty(k);
  });
});
