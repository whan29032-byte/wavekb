import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("the lottery schema, member UI, admin UI and deployment marker ship together", async () => {
  const migrations = (await readdir(new URL("supabase/migrations/", root))).filter((name) => name.endsWith(".sql")).sort();
  assert.equal(migrations.at(-1), "202609090002_reward_lottery.sql");

  const [migration, workflow, memberPage, memberRepository, memberComponent, adminPage, adminRepository, e2e] = await Promise.all([
    source("supabase/migrations/202609090002_reward_lottery.sql"),
    source(".github/workflows/deploy-backend-production.yml"),
    source("apps/web/src/app/rewards/page.tsx"),
    source("apps/web/src/lib/rewards/lottery-client-repository.ts"),
    source("apps/web/src/components/reward-lottery.tsx"),
    source("apps/web/src/app/admin/rewards/page.tsx"),
    source("apps/web/src/lib/admin/reward-lottery-client-repository.ts"),
    source("apps/web/e2e-ui/reliability.spec.ts"),
  ]);

  assert.match(migration, /select '202609090002'::text/);
  assert.match(workflow, /202609090002_reward_lottery\.sql/);
  assert.match(workflow, /test "\$schema" = 202609090002/);
  for (const table of ["reward_lottery_campaigns", "reward_lottery_prizes", "reward_lottery_draws", "reward_lottery_admin_audit"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(migration, /grant execute on function public\.get_my_reward_lottery\(\) to authenticated/);
  assert.match(migration, /grant execute on function public\.draw_reward_lottery\(uuid, uuid\) to authenticated/);
  assert.doesNotMatch(migration, /grant (insert|update|delete).*reward_lottery/i);

  assert.match(memberPage, /getMyRewardLottery\(\)/);
  assert.match(memberRepository, /draw_reward_lottery/);
  assert.match(memberComponent, /crypto\.randomUUID\(\)/);
  assert.match(adminPage, /getAdminRewardLottery\(\)/);
  assert.match(adminRepository, /admin_get_reward_lottery/);
  assert.match(e2e, /rewards-lottery--ready-to-draw/);
});
