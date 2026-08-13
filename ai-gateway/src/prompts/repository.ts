import { randomUUID } from "node:crypto";

type Environment = "test" | "production";
type Prompt = {
  id: string;
  key: string;
  label: string;
  taskType: string;
  active: Partial<Record<Environment, string>>;
};
type PromptVersion = {
  id: string;
  promptId: string;
  version: number;
  content: string;
  createdBy: string;
  createdAt: string;
};
type Audit = {
  action: "promote" | "rollback";
  promptId: string;
  environment: Environment;
  versionId: string;
  actor: string;
  reason: string;
  at: string;
};

export class InMemoryPromptRepository {
  private readonly prompts = new Map<string, Prompt>();
  private readonly versions = new Map<string, PromptVersion>();
  readonly audit: Audit[] = [];

  createPrompt(key: string, label: string, taskType: string): Prompt {
    const prompt = { id: randomUUID(), key, label, taskType, active: {} };
    this.prompts.set(prompt.id, prompt);
    return prompt;
  }

  createVersion(promptId: string, content: string, actor: string): PromptVersion {
    if (!this.prompts.has(promptId)) throw new Error("prompt not found");
    const previous = [...this.versions.values()].filter((item) => item.promptId === promptId);
    const version = {
      id: randomUUID(),
      promptId,
      version: previous.length + 1,
      content,
      createdBy: actor,
      createdAt: new Date().toISOString(),
    };
    this.versions.set(version.id, Object.freeze(version));
    return version;
  }

  getVersion(id: string): PromptVersion {
    const version = this.versions.get(id);
    if (!version) throw new Error("prompt version not found");
    return version;
  }

  promote(promptId: string, environment: Environment, versionId: string, actor: string, reason: string): void {
    const prompt = this.prompts.get(promptId);
    const version = this.getVersion(versionId);
    if (!prompt || version.promptId !== promptId) throw new Error("invalid prompt version");
    prompt.active[environment] = versionId;
    this.audit.push({
      action: "promote", promptId, environment, versionId, actor, reason,
      at: new Date().toISOString(),
    });
  }

  rollback(promptId: string, environment: Environment, versionId: string, actor: string, reason: string): void {
    this.promote(promptId, environment, versionId, actor, reason);
    const latest = this.audit.at(-1);
    if (latest) latest.action = "rollback";
  }

  activeVersion(promptId: string, environment: Environment): PromptVersion {
    const versionId = this.prompts.get(promptId)?.active[environment];
    if (!versionId) throw new Error("no active prompt version");
    return this.getVersion(versionId);
  }
}
