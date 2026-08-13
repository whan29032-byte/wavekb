import { classifyProviderError, selectNextModel, type ModelRoute } from "./router.ts";

type Job = { id: string; ownerId: string; payload: unknown };
type InvocationResult = {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  cost: number;
};
type WorkerDeps = {
  invoke(model: string, payload: unknown): Promise<InvocationResult>;
  recordAttempt(entry: Record<string, unknown>): void;
  recordUsage(entry: Record<string, unknown>): void;
};

export async function runWorkerOnce(job: Job, route: ModelRoute, deps: WorkerDeps) {
  const attempted = new Set<string>();
  let spent = 0;
  while (true) {
    const model = selectNextModel(route, attempted);
    if (!model) throw new Error("all configured models failed");
    attempted.add(model);
    const started = Date.now();
    try {
      const result = await deps.invoke(model, job.payload);
      spent += result.cost;
      if (spent > route.maxCost) throw Object.assign(new Error("job cost limit exceeded"), { code: "BUDGET" });
      deps.recordAttempt({ jobId: job.id, model, status: "succeeded", latencyMs: Date.now() - started });
      deps.recordUsage({
        jobId: job.id,
        ownerId: job.ownerId,
        model,
        ...result.usage,
        cost: result.cost,
      });
      return { actualModel: model, text: result.text, totalCost: spent };
    } catch (error) {
      const classification = classifyProviderError(error);
      deps.recordAttempt({
        jobId: job.id,
        model,
        status: "failed",
        errorClass: classification,
        latencyMs: Date.now() - started,
      });
      if (classification === "fatal") throw error;
    }
  }
}
