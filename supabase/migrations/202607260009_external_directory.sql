create table if not exists public.external_recommendations (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('x', 'discord')),
  name text not null check (char_length(trim(name)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 300),
  url text not null unique check (
    char_length(url) <= 1000
    and url ~ '^https://'
  ),
  avatar_url text check (
    avatar_url is null
    or (
      char_length(avatar_url) <= 1000
      and avatar_url ~ '^https://'
    )
  ),
  active boolean not null default true,
  sort_order integer not null default 100 check (sort_order between 0 and 100000),
  verified_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists external_recommendations_public_order_idx
  on public.external_recommendations (active, sort_order, created_at);

alter table public.external_recommendations enable row level security;

drop policy if exists "public read active external recommendations"
  on public.external_recommendations;
create policy "public read active external recommendations"
  on public.external_recommendations
  for select
  to anon, authenticated
  using (active = true);

revoke all on public.external_recommendations from anon, authenticated;
grant select on public.external_recommendations to anon, authenticated;
grant all on public.external_recommendations to service_role;

insert into public.external_recommendations (
  platform,
  name,
  description,
  url,
  avatar_url,
  active,
  sort_order,
  verified_at
)
values
  (
    'x',
    'Elliott Wave Forecast',
    '多市场波浪分析与公开图表观察。',
    'https://x.com/ElliottForecast',
    'https://unavatar.io/x/ElliottForecast',
    true,
    10,
    now()
  ),
  (
    'x',
    'Japan Elliott Wave Research Institute',
    '英文发布的艾略特波浪研究与市场观察。',
    'https://x.com/ewrij225en',
    'https://unavatar.io/x/ewrij225en',
    true,
    20,
    now()
  ),
  (
    'x',
    'Elliott Wave International',
    '艾略特波浪理论教育、市场心理与公开研究内容。',
    'https://x.com/ElliottWaveIntl',
    'https://unavatar.io/x/ElliottWaveIntl',
    true,
    30,
    now()
  ),
  (
    'x',
    'Avi Gilburt',
    '以艾略特波浪为主要框架的市场结构观点。',
    'https://x.com/AviGilburt',
    'https://unavatar.io/x/AviGilburt',
    true,
    40,
    now()
  ),
  (
    'discord',
    'Elliott Wave Café',
    '围绕结构、心理、图表与交易复盘的波浪讨论社区。',
    'https://discord.gg/ffE3C8cvCs',
    'https://cdn.discordapp.com/icons/1424085606182551785/0bf18b8776c7572b52c500d319a6a5e9.png?size=256',
    true,
    50,
    now()
  ),
  (
    'discord',
    'Chart Wizard Trading',
    '以艾略特波浪理论和技术分析为主题的交易社区。',
    'https://discord.gg/c84v77kME3',
    'https://cdn.discordapp.com/icons/922242996299247666/583428cee9ec51189b2525f386d2dea4.png?size=256',
    true,
    60,
    now()
  ),
  (
    'discord',
    'Elliott Wave Analysis France',
    '法语艾略特波浪分析、学习与图表交流社区。',
    'https://discord.gg/CBxEyNnyzb',
    'https://cdn.discordapp.com/icons/952179577927630888/592c563b9e6b2a69af0f702a9860fc07.png?size=256',
    true,
    70,
    now()
  ),
  (
    'discord',
    'Koenz Trading',
    '提供艾略特波浪学习内容与交易图表讨论的社区。',
    'https://discord.gg/rTRFNWcTHY',
    'https://cdn.discordapp.com/icons/991287930201067520/df03621041f6b1be2355a3289e8e4426.png?size=256',
    true,
    80,
    now()
  )
on conflict (url) do nothing;
