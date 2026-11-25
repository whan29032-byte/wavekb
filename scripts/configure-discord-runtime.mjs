import { createHash, randomUUID } from "node:crypto";
import { chmod, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MANAGED_NAMES = new Set([
  "SUPABASE_SERVICE_ROLE_KEY",
  "DISCORD_BOT_API_SECRET",
  "DISCORD_BOT_GUILD_ID",
  "DISCORD_LINK_PUBLIC_ORIGIN",
]);

const SERVER_PATHS = Object.freeze({
  gateway: "/etc/elliott-wave/gateway.env",
  next: "/etc/wavekb/next-preview.env",
  backupRoot: "/var/backups/wavekb-next-production",
});

function configurationError(message = "discord_configuration_input_invalid") {
  const error = new Error(message);
  error.code = message;
  return error;
}

function hash(content) {
  return createHash("sha256").update(content).digest("hex");
}

function parseInput(input) {
  if (!Buffer.isBuffer(input) || input.length === 0 || input.length > 4096) {
    throw configurationError();
  }
  let parsed;
  try {
    parsed = JSON.parse(input.toString("utf8"));
  } catch {
    throw configurationError();
  }
  if (
    !parsed
    || typeof parsed !== "object"
    || Array.isArray(parsed)
    || Object.keys(parsed).length !== 1
    || typeof parsed.apiSecret !== "string"
    || Buffer.byteLength(parsed.apiSecret, "utf8") < 32
    || !/^[A-Za-z0-9_-]{43,128}$/.test(parsed.apiSecret)
  ) {
    throw configurationError();
  }
  return parsed.apiSecret;
}

function serviceRoleLine(gatewayEnv) {
  const matches = gatewayEnv
    .toString("utf8")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("SUPABASE_SERVICE_ROLE_KEY="));
  if (matches.length !== 1 || matches[0] === "SUPABASE_SERVICE_ROLE_KEY=") {
    throw configurationError("discord_service_role_key_invalid");
  }
  return matches[0];
}

function updatedEnvironment(original, serviceRole, apiSecret) {
  const lines = original.toString("utf8").split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  const kept = lines.filter((line) => {
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    return !match || !MANAGED_NAMES.has(match[1]);
  });
  return Buffer.from(`${[
    ...kept,
    serviceRole,
    `DISCORD_BOT_API_SECRET=${apiSecret}`,
    "DISCORD_BOT_GUILD_ID=1545731927733047306",
    "DISCORD_LINK_PUBLIC_ORIGIN=https://wavekb.com",
  ].join("\n")}\n`, "utf8");
}

async function atomicReplace(target, content) {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, target);
    await chmod(target, 0o600);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function configureDiscordRuntime({ gatewayEnvPath, nextEnvPath, backupPath, input }) {
  const apiSecret = parseInput(input);
  const gatewayEnv = await readFile(gatewayEnvPath);
  const serviceRole = serviceRoleLine(gatewayEnv);
  const original = await readFile(nextEnvPath);
  const configured = updatedEnvironment(original, serviceRole, apiSecret);

  await writeFile(backupPath, original, { flag: "wx", mode: 0o600 });
  await chmod(backupPath, 0o600);
  await atomicReplace(nextEnvPath, configured);

  return {
    status: "configured",
    newHash: hash(configured),
    backupPath,
  };
}

export async function rollbackDiscordRuntime({ nextEnvPath, backupPath, expectedHash }) {
  if (typeof expectedHash !== "string" || !/^[0-9a-f]{64}$/.test(expectedHash)) {
    throw configurationError();
  }
  const current = await readFile(nextEnvPath);
  if (hash(current) !== expectedHash) {
    throw configurationError("discord_configuration_changed");
  }
  const backup = await readFile(backupPath);
  await atomicReplace(nextEnvPath, backup);
  return {
    status: "rolled_back",
    restoredHash: hash(backup),
  };
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index === -1 || index === args.length - 1 || args.indexOf(name, index + 1) !== -1) {
    throw configurationError();
  }
  return args[index + 1];
}

function assertServerPaths(gatewayEnvPath, nextEnvPath, backupPath) {
  if (
    gatewayEnvPath !== SERVER_PATHS.gateway
    || nextEnvPath !== SERVER_PATHS.next
    || path.dirname(backupPath) !== SERVER_PATHS.backupRoot
    || !/^discord-config-[1-9][0-9]*-[1-9][0-9]*\.env$/.test(path.basename(backupPath))
  ) {
    throw configurationError();
  }
}

async function readStandardInput() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 4096) throw configurationError();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function main() {
  const [action, ...args] = process.argv.slice(2);
  const nextEnvPath = option(args, "--next-env");
  const backupPath = option(args, "--backup-file");
  if (action === "apply") {
    const gatewayEnvPath = option(args, "--gateway-env");
    assertServerPaths(gatewayEnvPath, nextEnvPath, backupPath);
    const receipt = await configureDiscordRuntime({
      gatewayEnvPath,
      nextEnvPath,
      backupPath,
      input: await readStandardInput(),
    });
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    return;
  }
  if (action === "rollback") {
    assertServerPaths(SERVER_PATHS.gateway, nextEnvPath, backupPath);
    const receipt = await rollbackDiscordRuntime({
      nextEnvPath,
      backupPath,
      expectedHash: option(args, "--expected-hash"),
    });
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    return;
  }
  throw configurationError();
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    const safeMessage = typeof error?.code === "string" && error.code.startsWith("discord_")
      ? error.code
      : "discord_configuration_failed";
    process.stderr.write(`${safeMessage}\n`);
    process.exitCode = 1;
  });
}
