// Cada descripción de lib/fieldHelp.ts se usa en alguna página, y cada <Hint id="…"> tiene texto.
// (TypeScript ya rechaza un id que no exista; esto atrapa las descripciones que quedaron sin uso.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const help = readFileSync('lib/fieldHelp.ts', 'utf8');
const keys = [...help.matchAll(/^\s*'([a-zA-Z]+\.[a-zA-Z]+)':/gm)].map(m => m[1]);

function files(dir) {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : [];
  });
}
const source = [...files('app'), ...files('components')].map(f => readFileSync(f, 'utf8')).join('\n');

test('descriptions exist', () => assert.ok(keys.length > 50, `${keys.length} keys`));

test('every description is used', () => {
  const unused = keys.filter(k => !source.includes(`'${k}'`) && !source.includes(`"${k}"`));
  assert.deepEqual(unused, []);
});

test('descriptions are short', () => {
  const texts = [...help.matchAll(/^\s*'[a-zA-Z]+\.[a-zA-Z]+':\s*'((?:[^'\\]|\\.)*)'/gm)].map(m => m[1]);
  assert.equal(texts.length, keys.length);
  for (const t of texts) assert.ok(t.length <= 200, `too long (${t.length}): ${t}`);
});
