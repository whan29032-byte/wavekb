# Discord Welcome Catch-up Design

## Intent

New members must receive the existing themed welcome and science/magic selection buttons even when they joined during a short bot outage. The server owner must be able to see those welcomes in the admissions channel without duplicate messages after a restart.

## Constraints

- Keep the current live `GuildMemberAdd` welcome behavior and channel.
- On `ClientReady`, reconcile human members who joined in the previous 24 hours.
- Send at most 10 catch-up welcomes per startup, oldest first.
- Persist delivery by guild, user, and Discord join timestamp so restarts do not repeat a welcome, while a later rejoin can be welcomed again.
- Record delivery only after Discord accepts the message.
- A fetch or send failure is logged and must not crash the bot.
- Do not backfill older members or post a server-wide batch announcement.

## Approaches

1. Keep event-only delivery. This is simple but Discord never replays joins missed while the bot is offline, which caused the current gap.
2. Scan the last 24 hours on every startup without persistence. This recovers gaps but repeats messages on every restart.
3. Scan a bounded 24-hour window and persist successful deliveries. This is selected because it recovers short outages, avoids historical spam, and remains idempotent.

## Components

- SQLite gains a `member_welcomes` delivery ledger.
- A focused welcome service owns one-member delivery and bounded startup reconciliation.
- The Discord client uses the same delivery path for live events and startup catch-up.

## Success Criteria

- A missed recent human join produces one welcome after startup.
- Bots, joins older than 24 hours, and already delivered joins produce no message.
- Restarting produces no duplicate.
- Live joins still receive the themed message and both route buttons.
