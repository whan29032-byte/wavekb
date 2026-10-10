#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildHermesTheoryArtifact, buildCuratedHermesTheoryArtifact, HermesTheoryArtifactError, summarizeHermesTheoryArtifact, writeHermesTheoryArtifact,
} from "./lib/hermes-theory-artifact.mjs";

export function runHermesTheoryExport(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    let sourceRoot = path.join(os.homedir(), ".hermes", "skills", "research", "elliott-wave-theory");
    let output;
    let curate = false;
    const seen = new Set();
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (arg === "--curate" && !seen.has(arg)) { seen.add(arg); curate = true; continue; }
      if (!["--source-root", "--output"].includes(arg) || seen.has(arg) || !args[index + 1] || args[index + 1].startsWith("--")) throw new HermesTheoryArtifactError("E_ARGUMENTS");
      seen.add(arg);
      const value = args[++index];
      if (!path.isAbsolute(value) || path.resolve(value) !== value) throw new HermesTheoryArtifactError("E_ARGUMENTS");
      if (arg === "--source-root") sourceRoot = value;
      else output = value;
    }
    const artifact = (curate ? buildCuratedHermesTheoryArtifact : buildHermesTheoryArtifact)({ sourceRoot });
    const summary = output ? writeHermesTheoryArtifact(artifact, output) : summarizeHermesTheoryArtifact(artifact);
    stdout.write(`${JSON.stringify({ ok: true, mode: output ? "private-artifact-written" : "metadata-dry-run", ...summary })}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof HermesTheoryArtifactError ? error.code : "E_EXPORT_FAILED";
    stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = runHermesTheoryExport(process.argv.slice(2));
