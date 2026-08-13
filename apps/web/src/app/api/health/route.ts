import { publicSupabaseConfig } from '@/lib/env';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    {
      ok: true,
      service: 'wavekb-next',
      deployment: process.env.DEPLOYMENT_VERSION || 'development',
      supabaseConfigured: publicSupabaseConfig().configured,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
