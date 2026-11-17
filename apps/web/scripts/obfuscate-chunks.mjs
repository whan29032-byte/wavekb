import fs from "node:fs";
import path from "node:path";
import JavaScriptObfuscator from "javascript-obfuscator";

// 构建后对客户端 chunk 做一层混淆。只处理 ≥2048 字节的文件：
// 小文件混淆收益低、还容易把运行时报错堆栈变成噪声。
const MIN_BYTES = 2048;
const CHUNKS_DIR = path.join(process.cwd(), ".next", "static", "chunks");

const options = {
  compact: true,
  identifierNamesGenerator: "hexadecimal",
  // Turbopack 的 chunk 之间共享全局，改全局名会把运行时拆散。
  renameGlobals: false,
  selfDefending: false,
  stringArray: true,
  stringArrayThreshold: 0.75,
  stringArrayEncoding: ["base64"],
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  deadCodeInjection: false,
  sourceMap: false,
};

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && full.endsWith(".js")) yield full;
  }
}

function main() {
  if (!fs.existsSync(CHUNKS_DIR)) {
    console.log("[obfuscate-chunks] no chunks directory, nothing to do");
    return;
  }
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  for (const file of walk(CHUNKS_DIR)) {
    const source = fs.readFileSync(file, "utf8");
    if (Buffer.byteLength(source, "utf8") < MIN_BYTES) {
      skipped += 1;
      continue;
    }
    try {
      const result = JavaScriptObfuscator.obfuscate(source, options).getObfuscatedCode();
      fs.writeFileSync(file, result, "utf8");
      processed += 1;
    } catch (error) {
      // 单个 chunk 混淆失败必须回写原文：不能让一个坏文件把整次构建弄挂。
      fs.writeFileSync(file, source, "utf8");
      failed += 1;
      console.warn(`[obfuscate-chunks] kept original for ${path.relative(CHUNKS_DIR, file)}: ${error.message}`);
    }
  }
  console.log(`[obfuscate-chunks] processed ${processed}, skipped ${skipped}, kept-original ${failed}`);
}

main();
