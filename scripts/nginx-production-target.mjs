import fs from "node:fs";
import { pathToFileURL } from "node:url";

// Read nginx -T, including its concatenated included files. This deliberately
// accepts only an explicit HTTPS virtual host and a verifiable root proxy;
// unsupported/dynamic configurations require an operator review.
export function verifyNginxTarget(config) {
  const tokens = config.match(/#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[{};]|[^\s{};#]+/g) ?? [];
  const root = { children: [] };
  const stack = [root];
  let words = [];
  for (const token of tokens) {
    if (token.startsWith("#")) continue;
    if (token === "{" || token === ";") {
      if (!words.length) throw new Error("Unsupported Nginx syntax; review target");
      const node = { name: words[0], args: words.slice(1), children: [] };
      stack.at(-1).children.push(node); words = [];
      if (token === "{") stack.push(node);
    } else if (token === "}") {
      if (words.length || stack.length === 1) throw new Error("Unsupported Nginx syntax; review target");
      stack.pop();
    } else words.push(/^["']/.test(token) ? token.slice(1, -1) : token);
  }
  if (stack.length !== 1 || words.length) throw new Error("Incomplete Nginx target configuration");
  const all = [];
  const visit = (node) => { all.push(node); for (const child of node.children) visit(child); };
  visit(root);
  const sites = all.filter((node) => node.name === "server" && node.children.some((child) => child.name === "server_name" && child.args.includes("wavekb.com")) && node.children.some((child) => child.name === "listen" && /(?:^|:)443$/.test(child.args[0])));
  if (!sites.length) throw new Error("Production HTTPS domain is not explicitly configured");
  for (const site of sites) {
    const canonicalRedirect = (node) => node.name === "if" && node.args.join(" ") === "($host = www.wavekb.com)" && node.children.length === 1 && node.children[0].name === "return" && node.children[0].args.join(" ") === "301 https://wavekb.com$request_uri";
    const unsafeRouting = (node) => (["return", "rewrite", "try_files", "if", "error_page"].includes(node.name) && !canonicalRedirect(node)) || (node.name === "include" && node.args[0] !== "/etc/letsencrypt/options-ssl-nginx.conf");
    if (site.children.some(unsafeRouting)) throw new Error("Unsupported production routing override (conditional/rewrite/include)");
    for (const location of site.children.filter((child) => child.name === "location")) {
      if (location.args.join(" ") === "= /") throw new Error("Competing exact root target requires review");
      if (["~", "~*"].includes(location.args[0])) {
        let matches;
        try { matches = new RegExp(location.args[1], location.args[0] === "~*" ? "i" : "").test("/"); }
        catch { throw new Error("Unsupported regex routing requires review"); }
        if (matches) throw new Error("Competing regex root target requires review");
      }
    }
    const locations = site.children.filter((child) => child.name === "location" && (child.args.join(" ") === "/" || child.args.join(" ") === "^~ /"));
    if (locations.length !== 1) throw new Error("Ambiguous production root target");
    if (locations[0].children.some(unsafeRouting)) throw new Error("Unsupported root routing override");
    const proxies = locations[0].children.filter((child) => child.name === "proxy_pass");
    if (proxies.length !== 1) throw new Error("Production root target is not an explicit proxy");
    const target = proxies[0].args[0];
    if (/^http:\/\/127\.0\.0\.1:3100\/?$/.test(target)) continue;
    const name = /^http:\/\/([A-Za-z0-9_-]+)\/?$/.exec(target)?.[1];
    const groups = all.filter((node) => node.name === "upstream" && node.args[0] === name);
    const servers = groups.length === 1 ? groups[0].children.filter((child) => child.name === "server") : [];
    if (!name || servers.length !== 1 || servers[0].args[0] !== "127.0.0.1:3100") throw new Error("Production root target is not the local Next.js service");
  }
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { verifyNginxTarget(fs.readFileSync(0, "utf8")); console.log("wavekb.com HTTPS root routes to Next.js 127.0.0.1:3100. Configuration values omitted."); }
  catch (error) { console.error(`Nginx production target could not be verified: ${error.message}. Stop before production writes.`); process.exitCode = 1; }
}
