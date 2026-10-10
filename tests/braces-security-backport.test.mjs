import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

// No network, advisory allowlist, or audit suppression: test the exact package
// actually resolved by each installed consumer, not a standalone imitation.
const root = fileURLToPath(new URL("../", import.meta.url));
const virtualStore = path.join(root, "node_modules/.pnpm");
const require = createRequire(import.meta.url);
const consumers = readdirSync(virtualStore).filter((name) => !name.startsWith("braces@"))
  .map((name) => ({ name, entry: path.join(virtualStore, name, name === "node_modules" ? "braces" : "node_modules/braces") }))
  .filter(({ entry }) => existsSync(entry));
assert.ok(consumers.length > 0, "Expected the installed micromatch consumer of braces");
const entries = [...new Set(consumers.map(({ entry }) => realpathSync(entry)))];
const packageRoot = entries[0];
const braces = require(packageRoot);
const direct = Object.fromEntries(["parse", "compile", "expand", "stringify"].map((name) => [name, require(path.join(packageRoot, `lib/${name}.js`))]));
const guarded = (error, code = "BRACES_MAX_DEPTH") => error instanceof SyntaxError && error.code === code
  && !/Maximum call stack size exceeded/.test(error.message);
const options = { maxDepth: Infinity, maxLength: Infinity, strict: false, rangeLimit: false };
const nested = (count, open = "{", close = "}") => open.repeat(count) + "a,b" + close.repeat(count);
const astAtDepth = (count) => {
  const ast = { type: "root", nodes: [] };
  let current = ast;
  for (let depth = 0; depth < count; depth++) {
    const node = { type: "paren", nodes: [], parent: current };
    current.nodes.push(node); current = node;
  }
  current.nodes.push({ type: "text", value: "safe", parent: current });
  return ast;
};
const inChild = (body) => {
  const result = spawnSync(process.execPath, ["-e", `const assert = require("node:assert/strict");
const braces = require(${JSON.stringify(packageRoot)});
const direct = Object.fromEntries(["parse", "compile", "expand", "stringify"].map(name => [name, require(${JSON.stringify(packageRoot)} + "/lib/" + name + ".js")]));
const guarded = ${guarded.toString()};
const astAtDepth = ${astAtDepth.toString()};
const options = ${JSON.stringify({ maxDepth: 100000, maxLength: 100000, strict: false, rangeLimit: false })};
${body}`], { encoding: "utf8", timeout: 10_000, maxBuffer: 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 0, result.stderr);
};

test("the tracked patch hash and every resolved consumer use the same security backport", () => {
  const patch = readFileSync(path.join(root, "patches/braces@3.0.3.patch"));
  const hash = createHash("sha256").update(patch).digest("hex");
  const workspace = readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8");
  const lock = readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8");
  assert.match(workspace, /patchedDependencies:\s*\n\s+braces@3\.0\.3: patches\/braces@3\.0\.3\.patch/);
  assert.match(lock, new RegExp(`patchedDependencies:\\s*\\n\\s+braces@3\\.0\\.3: ${hash}`));
  assert.equal(entries.length, 1, "No unpatched braces resolution may remain among installed consumers");
  for (const { name, entry } of consumers) {
    assert.ok(realpathSync(entry).includes(`braces@3.0.3_patch_hash=${hash}`), name);
    assert.equal(require(path.join(entry, "package.json")).version, "3.0.3", "Do not fabricate an upstream fixed version");
    assert.throws(() => require(entry)(nested(3500), options), guarded, name);
  }
});

test("actual micromatch brace compilation and expansion call paths use the guard", () => {
  const consumer = consumers.find(({ name }) => name.startsWith("micromatch@"));
  assert.ok(consumer, "Expected the actual installed micromatch consumer");
  const micromatch = createRequire(path.join(consumer.entry, "../micromatch/package.json"))("micromatch");
  for (const api of ["braces", "braceExpand"]) {
    assert.throws(() => micromatch[api](nested(3500), options), guarded);
    assert.doesNotThrow(() => micromatch[api]("*.{js,ts,tsx}"));
  }
});

for (const api of ["default", "create", "parse", "compile", "expand", "stringify", "default-expand"]) {
  test(`${api} rejects brace, parenthesis, mixed, and unclosed nesting before stack exhaustion`, () => {
    inChild(`
const call = ${api === "default" ? "braces" : api === "default-expand" ? "(input, opts) => braces(input, { ...opts, expand: true })" : `braces.${api}`};
const patterns = ["{".repeat(3500) + "a,b" + "}".repeat(3500), "(".repeat(3500) + "a,b" + ")".repeat(3500), "{(".repeat(1750) + "a,b" + ")}".repeat(1750), "{".repeat(3500) + "a,b"];
for (const pattern of patterns) assert.throws(() => call(pattern, options), guarded);
assert.throws(() => call("{".repeat(101) + "a,b" + "}".repeat(101), { maxDepth: false, strict: false }), guarded);
`);
  });
}

for (const api of ["parse", "compile", "expand", "stringify"]) {
  test(`direct lib/${api} entry is guarded without the public wrapper`, () => {
    inChild(api === "parse"
      ? `assert.throws(() => direct.parse("{".repeat(3500) + "a,b" + "}".repeat(3500), options), guarded);`
      : `for (const depth of [101, 3500, 10000]) assert.throws(() => direct.${api}(astAtDepth(depth), options), guarded);`);
  });
}

for (const api of ["compile", "expand", "stringify"]) {
  test(`${api} accepts depth 100 ASTs and rejects depth 101, cycles, and excess nodes`, () => {
    assert.doesNotThrow(() => braces[api](astAtDepth(100), options));
    assert.throws(() => braces[api](astAtDepth(101), options), guarded);
    inChild(`
const cyclic = { type: "root", nodes: [] }; cyclic.nodes.push(cyclic);
assert.throws(() => braces.${api}(cyclic, options), error => guarded(error, "BRACES_INVALID_AST"));
const wide = { type: "root", nodes: Array.from({ length: 20000 }, () => ({ type: "text", value: "a" })) };
assert.throws(() => braces.${api}(wide, options), error => guarded(error, "BRACES_MAX_NODES"));
`);
  });
}

test("parse and all string APIs accept the 100-level boundary", () => {
  for (const pattern of [nested(100), nested(100, "(", ")"), "{(".repeat(50) + "a,b" + ")}".repeat(50)]) {
    for (const call of [braces, braces.create, braces.parse, braces.compile, braces.expand, braces.stringify, direct.parse]) {
      assert.doesNotThrow(() => call(pattern, options));
    }
  }
});

test("escaped, quoted, and character-class braces remain literals and do not count as nesting", () => {
  for (const pattern of ["\\{".repeat(200) + "a,b" + "\\}".repeat(200), '"' + nested(200) + '"', "[" + nested(200) + "]"]) {
    assert.doesNotThrow(() => braces.compile(pattern));
    assert.doesNotThrow(() => braces.expand(pattern));
  }
});

test("repeated sibling AST references are not mistaken for ancestor cycles", () => {
  const shared = { type: "text", value: "x" };
  const ast = () => ({ type: "root", nodes: [shared, shared] });
  assert.equal(braces.compile(ast()), "xx");
  assert.equal(braces.stringify(ast()), "xx");
  assert.deepEqual(braces.expand(ast()), ["xx"]);
});

test("expand rejects cyclic parent links instead of hanging", () => {
  inChild(`
const node = { type: "paren", nodes: [{ type: "text", value: "a" }] }; node.parent = node;
assert.throws(() => braces.expand(node, options), guarded);
`);
});

// Golden results captured from the original npm braces@3.0.3 release. These
// preserve nested alternatives, extglobs, ranges, invalid/escaped literals,
// quotes, filtering and glob compilation without fetching anything in CI.
const fixtures = [
  ["a/{b,c}/d", {}, "a/(b|c)/d", ["a/b/d", "a/c/d"], "a/{b,c}/d"],
  ["x{1..5}y", {}, "x([1-5])y", ["x1y", "x2y", "x3y", "x4y", "x5y"], "x{1..5}y"],
  ["{01..05}", {}, "(0[1-5])", ["01", "02", "03", "04", "05"], "{01..05}"],
  ["{5..1..2}", {}, "(1|3|5)", ["5", "3", "1"], "{5..1..2}"],
  ["{a..e..2}", {}, "(a|c|e)", ["a", "c", "e"], "{a..e..2}"],
  ["{a,{b,c}}", {}, "(a|(b|c))", ["a", "b", "c"], "{a,{b,c}}"],
  ["{a,b}{c,d}", {}, "(a|b)(c|d)", ["ac", "ad", "bc", "bd"], "{a,b}{c,d}"],
  ["*.{js,ts,tsx}", {}, "*.(js|ts|tsx)", ["*.js", "*.ts", "*.tsx"], "*.{js,ts,tsx}"],
  ["!(*.{test,spec}).{ts,tsx}", {}, "!(*.(test|spec)).(ts|tsx)", ["!(*.test).ts", "!(*.test).tsx", "!(*.spec).ts", "!(*.spec).tsx"], "!(*.{test,spec}).{ts,tsx}"],
  ["@(a|{b,c})", {}, "@(a|(b|c))", ["@(a|b)", "@(a|c)"], "@(a|{b,c})"],
  ["{a,,b}", {}, "(a|b)", ["a", "", "b"], "{a,,b}"],
  ["{a,a,b}", { nodupes: true }, "(a|a|b)", ["a", "b"], "{a,a,b}"],
  ["a/{b,c", {}, "a/{b,c", ["a/{b,c"], "a/{b,c"],
  ["a/{b,c", { escapeInvalid: true }, "a/\\{b,c", ["a/{b,c"], "a/{b,c"],
  ["a/\\{b,c\\}/d", {}, "a/{b,c}/d", ["a/{b,c}/d"], "a/{b,c}/d"],
  ["${a,b}", {}, "${a,b}", ["${a,b}"], "${a,b}"],
  ["[{}]{a,b}", {}, "[{}](a|b)", ["[{}]a", "[{}]b"], "[{}]{a,b}"],
  ['"{a,b}"{x,y}', {}, "{a,b}(x|y)", ["{a,b}x", "{a,b}y"], "{a,b}{x,y}"],
  ['"{a,b}"{x,y}', { keepQuotes: true }, '"{a,b}"(x|y)', ['"{a,b}"x', '"{a,b}"y'], '"{a,b}"{x,y}'],
  ["{a,b}", { keepEscaping: true }, "(a|b)", ["a", "b"], "{a,b}"],
  ["{1..3..0}", {}, "([1-3])", ["1", "2", "3"], "{1..3..0}"],
  ["{a,b},c", {}, "(a|b),c", ["a,c", "b,c"], "{a,b},c"],
  ["()", {}, "()", ["()"], "()"],
  ["{}", {}, "{}", ["{}"], "{}"],
  ["../**/{foo,bar}/[a-z].{js,ts}", {}, "../**/(foo|bar)/[a-z].(js|ts)", ["../**/foo/[a-z].js", "../**/foo/[a-z].ts", "../**/bar/[a-z].js", "../**/bar/[a-z].ts"], "../**/{foo,bar}/[a-z].{js,ts}"],
];

for (const [input, opts, compiled, expanded, stringified] of fixtures) {
  test(`original normal-pattern semantics remain unchanged: ${input} ${JSON.stringify(opts)}`, () => {
    assert.equal(braces.compile(input, opts), compiled);
    assert.deepEqual(braces.expand(input, opts), expanded);
    assert.equal(braces.stringify(input, opts), stringified);
    assert.deepEqual(braces(input, opts), [compiled]);
    assert.deepEqual(braces(input, { ...opts, expand: true }), expanded);
    assert.equal(direct.compile(braces.parse(input, opts), opts), compiled);
    assert.equal(direct.stringify(braces.parse(input, opts), opts), stringified);
  });
}

test("existing character and range limits still fail closed", () => {
  assert.throws(() => braces.parse("abc", { maxLength: 2 }), SyntaxError);
  assert.throws(() => braces.expand("{1..10000}"), RangeError);
  assert.deepEqual(braces.expand("{1..3}", { rangeLimit: 3 }), ["1", "2", "3"]);
  assert.deepEqual(braces(["{a,b}", "{b,c}"], { expand: true, nodupes: true }), ["a", "b", "c"]);
  assert.deepEqual(braces.expand("{a,,b}", { noempty: true }), ["a", "b"]);
});
