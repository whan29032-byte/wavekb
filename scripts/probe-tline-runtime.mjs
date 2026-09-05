// Sent over pinned SSH stdin before upload; no filesystem or service mutations.
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 18)) throw new Error("Node.js 22.18+ is required; deployment stopped");
const { DatabaseSync } = await import("node:sqlite");
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE probe (n INTEGER); INSERT INTO probe VALUES (1)");
if (db.prepare("SELECT n FROM probe").get().n !== 1) throw new Error("SQLite runtime probe failed");
db.close();
console.log(`Research runtime ready: Node ${process.versions.node}, SQLite available`);
