import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
const url = new URL("../scripts/nginx-production-target.mjs", import.meta.url);
const api = fs.existsSync(url) ? await import(url) : {};
const site = (host, target) => `server { listen 443 ssl; server_name ${host}; location / { proxy_pass http://${target}; } }`;

test("competing root locations and routing overrides fail closed", () => {
  for (const override of ["location = / { proxy_pass http://127.0.0.1:8080; }", "location ~ ^/ { proxy_pass http://127.0.0.1:8080; }", "rewrite ^ /elsewhere;", "include /unknown-routes.conf;"]) {
    assert.throws(() => api.verifyNginxTarget(site("wavekb.com", "127.0.0.1:3100").replace(/}$/, `${override} }`)), /target|routing/);
  }
  assert.throws(() => api.verifyNginxTarget(site("wavekb.com", "127.0.0.1:3100").replace("proxy_pass", "try_files /old.html @legacy; proxy_pass")), /routing/);
});

test("production domain is bound to its own HTTPS root upstream, not another virtual host", () => {
  assert.equal(typeof api.verifyNginxTarget, "function");
  assert.throws(() => api.verifyNginxTarget(site("wavekb.com", "127.0.0.1:8080") + site("staging.invalid", "127.0.0.1:3100")), /target/);
  assert.equal(api.verifyNginxTarget(site("wavekb.com www.wavekb.com", "127.0.0.1:3100")), true);
});
test("named upstreams resolve to the expected single local Next server", () => {
  assert.equal(typeof api.verifyNginxTarget, "function");
  assert.equal(api.verifyNginxTarget("upstream next_site { server 127.0.0.1:3100; keepalive 32; }" + site("wavekb.com", "next_site")), true);
  assert.throws(() => api.verifyNginxTarget("upstream next_site { server 127.0.0.1:8080; }" + site("wavekb.com", "next_site")), /target/);
});
test("comments, plain HTTP redirects and quoted braces cannot establish a false production target", () => {
  assert.equal(typeof api.verifyNginxTarget, "function");
  assert.equal(api.verifyNginxTarget('# server_name wrong; { }\nserver { listen 80; server_name wavekb.com; return 301 "https://wavekb.com/{ignored}"; }' + site('"wavekb.com"', "127.0.0.1:3100")), true);
  assert.throws(() => api.verifyNginxTarget(site("next-preview.wavekb.com", "127.0.0.1:3100")), /domain/);
});
