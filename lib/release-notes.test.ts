import test from 'node:test';
import assert from 'node:assert/strict';
import { inlineText, parseInline, parseReleaseNotes } from './release-notes.ts';

test('headings, lists and paragraphs', () => {
  const blocks = parseReleaseNotes('## Neu\n- Eins\n- Zwei\n\nEin Absatz\nüber zwei Zeilen.\n\n### Kleiner\nText');
  assert.deepEqual(blocks.map((b) => b.type), ['heading', 'list', 'paragraph', 'heading', 'paragraph']);
  assert.equal(blocks[0].type === 'heading' && blocks[0].level, 2);
  assert.equal(blocks[1].type === 'list' && blocks[1].items.length, 2);
  assert.equal(blocks[2].type === 'paragraph' && inlineText(blocks[2].children), 'Ein Absatz über zwei Zeilen.');
  assert.equal(blocks[3].type === 'heading' && blocks[3].level, 3);
});

test('GitHub line endings and the release title', () => {
  const md = '# Sooskasse-FinTS 4.1.0\r\n\r\nEin großes Update.\r\n\r\n## Neu\r\n- Updates in der App\r\n';
  const blocks = parseReleaseNotes(md, '4.1.0');
  // The title line repeats what the dialog already says.
  assert.equal(blocks[0].type, 'paragraph');
  assert.equal(blocks.length, 3);
  // A first heading that is something else stays.
  assert.equal(parseReleaseNotes('# Highlights\n- x', '4.1.0')[0].type, 'heading');
  // The app's new name (after 4.3) is a title too.
  assert.equal(parseReleaseNotes('# Girovo 5.0.0\n\nText', '5.0.0')[0].type, 'paragraph');
});

test('inline: bold, italic, code', () => {
  assert.deepEqual(parseInline('**Fett** und *kursiv* und `code`'), [
    { type: 'strong', children: [{ type: 'text', text: 'Fett' }] },
    { type: 'text', text: ' und ' },
    { type: 'em', children: [{ type: 'text', text: 'kursiv' }] },
    { type: 'text', text: ' und ' },
    { type: 'code', text: 'code' },
  ]);
  // Nothing inside code is markup.
  assert.deepEqual(parseInline('`**nicht fett**`'), [{ type: 'code', text: '**nicht fett**' }]);
  // Underscores inside words are not emphasis.
  assert.deepEqual(parseInline('snake_case_name'), [{ type: 'text', text: 'snake_case_name' }]);
  assert.deepEqual(parseInline('2 * 3 * 4'), [{ type: 'text', text: '2 * 3 * 4' }]);
});

test('inline: only https links become links', () => {
  assert.deepEqual(parseInline('[Release](https://github.com/x/y/releases)'), [
    { type: 'link', href: 'https://github.com/x/y/releases', children: [{ type: 'text', text: 'Release' }] },
  ]);
  assert.deepEqual(parseInline('[klick](javascript:alert(1))'), [{ type: 'text', text: 'klick' }]);
  assert.deepEqual(parseInline('[lokal](file:///C:/x)'), [{ type: 'text', text: 'lokal' }]);
  assert.deepEqual(parseInline('<https://example.com>'), [
    { type: 'link', href: 'https://example.com/', children: [{ type: 'text', text: 'https://example.com' }] },
  ]);
});

test('HTML, images and comments do not survive as markup', () => {
  const blocks = parseReleaseNotes('<details><summary>Mehr</summary>\n\n<img src=x onerror=alert(1)>Text ![Bild](https://x/y.png)\n<!-- intern -->\n</details>');
  assert.equal(blocks.length, 2);
  assert.equal(blocks.map((b) => (b.type === 'paragraph' ? inlineText(b.children) : '')).join('|'), 'Mehr|Text');
});

test('list items: numbered, continued lines, nested bullets flattened', () => {
  const blocks = parseReleaseNotes('1. Erstens\n   weiter\n2. Zweitens\n   - Unterpunkt');
  assert.equal(blocks.length, 1);
  const list = blocks[0];
  assert.equal(list.type, 'list');
  if (list.type !== 'list') return;
  assert.deepEqual(list.items.map(inlineText), ['Erstens weiter', 'Zweitens', 'Unterpunkt']);
});

test('fenced code stays code, rules disappear', () => {
  const blocks = parseReleaseNotes('Vorher\n\n---\n\n```\nnpm run electron:dist\n```');
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[1], { type: 'paragraph', children: [{ type: 'code', text: 'npm run electron:dist' }] });
});
