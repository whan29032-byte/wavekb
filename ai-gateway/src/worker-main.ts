import { hostname } from "node:os";
import { fileURLToPath } from "node:url";
import { loadConfig, type GatewayConfig } from "./config.ts";
import { classifyProviderError } from "./jobs/router.ts";
import { KnowledgeRuntime, type KnowledgeRuntimeResult } from "./knowledge/runtime.ts";
import { UserConnectionResolver } from "./secrets/user-connection.ts";
import { ManagedConnectionResolver } from "./secrets/managed-connection.ts";
import { SupabaseRest } from "./storage/supabase-rest.ts";
import { MembershipWalletWorker } from "./membership-wallet-worker.ts";

type WorkerDatabase = Pick<SupabaseRest, "request">;
type WorkerConnectionResolver = Pick<UserConnectionResolver, "resolve">;

export type ClaimedJob = {
  id: string;
  owner_id: string;
  analysis_id: string | null;
  user_connection_id?: string | null;
  execution_source?: "byok" | "managed";
  managed_model_id?: string | null;
  task_type: string;
  input_payload: Record<string, unknown>;
  knowledge_version?: string | null;
};

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

type WorkerKnowledgeRuntime = {
  run(input: {
    job: ClaimedJob;
    analysis: Record<string, unknown>;
    connection: Awaited<ReturnType<UserConnectionResolver["resolve"]>>;
  }): Promise<KnowledgeRuntimeResult>;
};

export class AiJobWorker {
  private readonly config: GatewayConfig;
  private readonly workerId: string;
  private readonly database: WorkerDatabase;
  private readonly connections: WorkerConnectionResolver;
  private readonly managedConnections: Pick<ManagedConnectionResolver, "resolve">;
  private readonly knowledgeRuntime: WorkerKnowledgeRuntime;
  private readonly now: () => number;
  private stopping = false;

  constructor(
    config: GatewayConfig,
    workerId = `${hostname()}:${process.pid}`,
    dependencies: {
      database?: WorkerDatabase;
      connections?: WorkerConnectionResolver;
      managedConnections?: Pick<ManagedConnectionResolver, "resolve">;
      now?: () => number;
      knowledgeRuntime?: WorkerKnowledgeRuntime;
    } = {},
  ) {
    this.config = config;
    this.workerId = workerId;
    this.database = dependencies.database ?? new SupabaseRest(config);
    this.connections = dependencies.connections ?? new UserConnectionResolver(config);
    this.managedConnections = dependencies.managedConnections ?? new ManagedConnectionResolver(config, this.database);
    this.now = dependencies.now ?? Date.now;
    this.knowledgeRuntime = dependencies.knowledgeRuntime ?? new KnowledgeRuntime({
      database: this.database,
    });
  }

  stop() { this.stopping = true; }

  private async claim(): Promise<ClaimedJob | null> {
    const result = await this.database.request("/rest/v1/rpc/claim_ai_job", {
      method: "POST",
      body: { p_worker_id: this.workerId },
    });
    return result?.id ? result as ClaimedJob : null;
  }

  private async attempts(jobId: string): Promise<number> {
    const rows = await this.database.request(`/rest/v1/ai_job_attempts?job_id=eq.${encodeURIComponent(jobId)}&select=id`);
    return Array.isArray(rows) ? rows.length : 0;
  }

  private async patchJob(jobId: string, body: Record<string, unknown>) {
    await this.database.request(`/rest/v1/ai_jobs?id=eq.${encodeURIComponent(jobId)}`, {
      method: "PATCH",
      headers: { prefer: "return=minimal" },
      body,
    });
  }

  async runJob(job: ClaimedJob): Promise<void> {
    const attemptNumber = await this.attempts(job.id) + 1;
    const attemptRows = await this.database.request("/rest/v1/ai_job_attempts", {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: { job_id: job.id, attempt_number: attemptNumber, status: "running" },
    });
    const attemptId = attemptRows?.[0]?.id as string | undefined;
    const started = this.now();
    try {
      const managed = job.execution_source === "managed";
      if (!job.analysis_id || (managed ? !job.managed_model_id || job.user_connection_id : !job.user_connection_id)) throw new Error("job connection or analysis is missing");
      if (managed) {
        if (!this.config.MEMBERSHIP_MANAGED_AI_ENABLED) throw new Error("managed_ai_disabled");
        const authorized = await this.database.request("/rest/v1/rpc/authorize_membership_ai_job", {
          method: "POST", body: { p_job_id: job.id, p_owner_id: job.owner_id },
        });
        if (authorized !== true) throw new Error("membership_ai_job_invalid");
      }
      const profiles = await this.database.request(
        `/rest/v1/profiles?id=eq.${encodeURIComponent(job.owner_id)}&account_status=eq.active&select=id&limit=1`,
      );
      if (!profiles.length) throw new Error("account restricted");
      const analyses = await this.database.request(
        `/rest/v1/workbench_analyses?id=eq.${encodeURIComponent(job.analysis_id)}&owner_id=eq.${encodeURIComponent(job.owner_id)}&select=*&limit=1`,
      );
      if (!analyses.length) throw new Error("analysis not found");
      const connection = managed
        ? await this.managedConnections.resolve(job.owner_id, job.task_type, job.managed_model_id!)
        : await this.connections.resolve(job.owner_id, job.user_connection_id!);
      const result = await this.knowledgeRuntime.run({
        job,
        analysis: analyses[0],
        connection,
      });
      const finishedAt = new Date(this.now()).toISOString();
      if (attemptId) {
        await this.database.request(`/rest/v1/ai_job_attempts?id=eq.${encodeURIComponent(attemptId)}`, {
          method: "PATCH",
          headers: { prefer: "return=minimal" },
          body: { status: "succeeded", provider_request_id: result.provider?.providerRequestId ?? null, latency_ms: this.now() - started, finished_at: finishedAt },
        });
      }
      await this.database.request("/rest/v1/ai_usage_ledger", {
        method: "POST",
        headers: { prefer: "return=minimal" },
        body: {
          job_id: job.id,
          attempt_id: attemptId ?? null,
          owner_id: job.owner_id,
          model_id: managed ? job.managed_model_id : null,
          input_tokens: Math.max(0, Number(result.provider?.usage.inputTokens || 0)),
          output_tokens: Math.max(0, Number(result.provider?.usage.outputTokens || 0)),
          cost_amount: 0,
          cost_confirmed: false,
        },
      });
      await this.patchJob(job.id, {
        status: "succeeded",
        ...(managed ? { actual_model_id: job.managed_model_id } : {}),
        input_payload: result.normalizedRequest,
        knowledge_version: result.knowledgeVersion,
        output_payload: result.output,
        error_code: null,
        error_message: null,
        finished_at: finishedAt,
      });
    } catch (error) {
      const classification = classifyProviderError(error);
      const retry = classification === "retryable" && attemptNumber < 3;
      const runtimeCode = (error as { code?: unknown })?.code;
      const provider = (error as { provider?: KnowledgeRuntimeResult["provider"] })?.provider;
      const errorCode = runtimeCode === "knowledge_unavailable" || runtimeCode === "invalid_model_output"
        ? runtimeCode
        : classification;
      const finishedAt = new Date(this.now()).toISOString();
      if (attemptId) {
        await this.database.request(`/rest/v1/ai_job_attempts?id=eq.${encodeURIComponent(attemptId)}`, {
          method: "PATCH",
          headers: { prefer: "return=minimal" },
          body: {
            status: "failed",
            error_class: classification,
            provider_request_id: provider?.providerRequestId ?? null,
            latency_ms: this.now() - started,
            finished_at: finishedAt,
          },
        }).catch(() => undefined);
      }
      if (provider) {
        await this.database.request("/rest/v1/ai_usage_ledger", {
          method: "POST",
          headers: { prefer: "return=minimal" },
          body: {
            job_id: job.id,
            attempt_id: attemptId ?? null,
            owner_id: job.owner_id,
            input_tokens: Math.max(0, Number(provider.usage.inputTokens || 0)),
            output_tokens: Math.max(0, Number(provider.usage.outputTokens || 0)),
            cost_amount: 0,
            cost_confirmed: false,
          },
        }).catch(() => undefined);
      }
      await this.patchJob(job.id, retry ? {
        status: "waiting_retry",
        available_at: new Date(this.now() + attemptNumber * 15_000).toISOString(),
        error_code: errorCode,
        error_message: "模型请求暂时失败，服务器将自动重试。",
        worker_id: null,
      } : {
        status: "failed",
        error_code: errorCode,
        error_message: "AI 候选分析未完成，请检查模型连接后重试。",
        finished_at: finishedAt,
      });
    }
  }

  async run(): Promise<void> {
    while (!this.stopping) {
      try {
        const job = await this.claim();
        if (job) await this.runJob(job);
        else await wait(1500);
      } catch {
        await wait(5000);
      }
    }
  }
}

const isMain = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (isMain) {
  const config = loadConfig(process.env);
  const database = new SupabaseRest(config);
  const worker = new AiJobWorker(config, undefined, { database });
  const walletWorker = new MembershipWalletWorker({
    database,
    env: process.env,
    workerId: `${hostname()}:${process.pid}:membership-wallet`,
  });
  const stop = () => { worker.stop(); walletWorker.stop(); };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  await Promise.all([worker.run(), walletWorker.run()]);
}
