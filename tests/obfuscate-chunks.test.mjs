import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import {
  identifiersPrefixForChunk,
  obfuscateChunkSource,
} from "../apps/web/scripts/obfuscate-chunks.mjs";

test("separately obfuscated chunks receive stable distinct global identifier prefixes", () => {
  const firstFile = path.resolve("apps/web/.next/static/chunks/app/first.js");
  const secondFile = path.resolve("apps/web/.next/static/chunks/app/second.js");
  const firstPrefix = identifiersPrefixForChunk(firstFile);
  const secondPrefix = identifiersPrefixForChunk(secondFile);

  assert.match(firstPrefix, /^_wk_[a-f0-9]{12}_$/);
  assert.equal(identifiersPrefixForChunk(firstFile), firstPrefix);
  assert.notEqual(firstPrefix, secondPrefix);

  const source = (label) => `(() => { const value = ${JSON.stringify(`${label}-${"x".repeat(3000)}`)}; globalThis.results.push(value.length); })();`;
  const first = obfuscateChunkSource(source("first"), firstFile);
  const second = obfuscateChunkSource(source("second"), secondFile);
  assert.match(first, /^\(function\(\)\{/);
  assert.match(first, /\}\)\.call\(globalThis\);$/);
  assert.match(first, new RegExp(firstPrefix));
  assert.match(second, new RegExp(secondPrefix));

  const context = vm.createContext({ results: [] });
  assert.doesNotThrow(() => {
    new vm.Script(first).runInContext(context);
    new vm.Script(first).runInContext(context);
    new vm.Script(second).runInContext(context);
    new vm.Script(second).runInContext(context);
  });
  assert.equal(context.results.length, 4);
});
