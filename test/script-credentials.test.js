import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const scripts = ['script.sh', 'script2.sh'];

test('LlamaIndex scripts load the API key from scripts/.env for authorization', async () => {
  for (const scriptName of scripts) {
    const script = await readFile(new URL(`../scripts/${scriptName}`, import.meta.url), 'utf8');
    const authorizationLines = script.split(/\r?\n/).filter(line => /Authorization:/i.test(line));

    assert.ok(script.includes('source "$SCRIPT_DIR/.env"'));
    assert.ok(script.includes(': "${LLAMAINDEX_API_KEY:?Missing LLAMAINDEX_API_KEY}"'));
    assert.ok(authorizationLines.length > 0);
    assert.ok(authorizationLines.every(line =>
      /Authorization:\s*Bearer \$LLAMAINDEX_API_KEY["']/i.test(line)
    ));
  }
});
