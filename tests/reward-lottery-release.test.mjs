import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("the lottery schema, member UI, admin UI and deployment marker ship together", async () => {
  const migrations = (await readdir(new URL("supabase/migrations/", root))).filter((name) => name.endsWith(".sql")).sort();
  assert.equal(migrations.at(-1), "202610100005_membership_wallet_payments.sql");

  const [migration, manualMigration, customDisplayMigration, workflow, memberPage, memberRepository, memberComponent, adminPage, adminRepository, e2e] = await Promise.all([
    source("supabase/migrations/202609090002_reward_lottery.sql"),
    source("supabase/migrations/202609100001_reward_lottery_manual_fulfillment.sql"),
    source("supabase/migrations/202610080001_admin_custom_trading_display.sql"),
    source(".github/workflows/deploy-backend-production.yml"),
    source("apps/web/src/app/rewards/page.tsx"),
    source("apps/web/src/lib/rewards/lottery-client-repository.ts"),
    source("apps/web/src/components/reward-lottery.tsx"),
    source("apps/web/src/app/admin/rewards/page.tsx"),
    source("apps/web/src/lib/admin/reward-lottery-client-repository.ts"),
    source("apps/web/e2e-ui/reliability.spec.ts"),
  ]);

  assert.match(migration, /select '202609090002'::text/);
  assert.match(manualMigration, /fulfillment_type = 'manual' and reward_points is null/);
  assert.match(manualMigration, /select '202609100001'::text/);
  assert.match(customDisplayMigration, /select '202610080001'::text/);
  assert.match(workflow, /202609090002\)[\s\S]*202609100001_reward_lottery_manual_fulfillment\.sql[\s\S]*202610080001_admin_custom_trading_display\.sql/);
  const mentorNotifications = await source("supabase/migrations/202610080003_mentor_payment_notifications.sql");
  assert.match(mentorNotifications, /select '202610080003'::text/);
  assert.doesNotMatch(mentorNotifications, /(?:drop|alter) (?:table|function) public\.reward_lottery/);
  assert.match(workflow, /test "\$schema" = 202610100005/);
  for (const table of ["reward_lottery_campaigns", "reward_lottery_prizes", "reward_lottery_draws", "reward_lottery_admin_audit"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(migration, /grant execute on function public\.get_my_reward_lottery\(\) to authenticated/);
  assert.match(migration, /grant execute on function public\.draw_reward_lottery\(uuid, uuid\) to authenticated/);
  assert.doesNotMatch(migration, /grant (insert|update|delete).*reward_lottery/i);

  assert.match(memberPage, /getMyRewardLottery\(\)/);
  assert.match(memberRepository, /draw_reward_lottery/);
  assert.match(memberComponent, /crypto\.randomUUID\(\)/);
  assert.doesNotMatch(memberComponent, /奖励已自动到账/);
  assert.match(adminPage, /getAdminRewardLottery\(\)/);
  assert.match(adminRepository, /admin_get_reward_lottery/);
  assert.match(adminRepository, /p_fulfillment_type: "manual"/);
  assert.match(adminRepository, /p_reward_points: null/);
  assert.match(e2e, /rewards-lottery--ready-to-draw/);
});
