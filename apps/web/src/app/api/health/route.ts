export const dynamic = 'force-dynamic';

// 只暴露存活状态与部署版本：部署流水线断言 deployment === RELEASE_SHA，
// 这个字段不能删。其余信息（服务名、Supabase 配置状态）对公网无价值，不再下发。
export function GET() {
  return Response.json(
    {
      ok: true,
      deployment: process.env.DEPLOYMENT_VERSION || 'development',
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
