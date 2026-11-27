# Discord Bot Cloud Deployment Design

## Intent

Run the existing `悠悠的宝宝` Discord community bot continuously without depending on the owner's Windows PC, while keeping its token and website API secret out of Git and preserving the current SQLite profile data.

## Goals

- Deploy the reviewed bot source to the existing WaveKB production host.
- Run it as a hardened, auto-restarting systemd service.
- Keep the Discord token and website integration secret in GitHub Actions/host environment files only.
- Persist the SQLite database across immutable code releases and seed it once from the current local database.
- Verify the service is active and the bot has reached Discord before ending a deployment.

## Non-goals

- Do not redesign game commands, economy rules, roles, or website APIs.
- Do not store secrets, runtime databases, logs, or `.env` files in the repository.
- Do not replace the existing website deployment workflows.

## Constraints

- Node.js 22 and the existing `discord.js`, `better-sqlite3`, and canvas stack remain unchanged.
- The existing WaveKB production SSH host, pinned host fingerprint, GitHub `production` environment, and rollback conventions are reused.
- The local bot stays online until the cloud instance passes acceptance, then it is stopped to avoid duplicate event handling.

## Approaches

1. **Existing WaveKB host with systemd (selected).** Reuses the already secured deployment channel, supports persistent SQLite state, rollback, restart-on-failure, and no new paid platform account.
2. **Managed bot hosting such as Railway or Render.** Simpler initial UI but adds a new account, recurring cost/sleep constraints, and a separate secret/persistence model.
3. **Windows startup task.** Restarts after reboot but still fails whenever the PC is off, so it does not meet the availability goal.

The first approach is selected because the user delegated the hosting choice and the repository already has a hardened production server workflow.

## Design

- Vendor the current bot runtime under `services/discord-bot/` as an independently installable Node package, excluding local secrets, logs, and live data.
- Add `elliott-wave-discord-bot.service` with `DynamicUser`, a systemd `StateDirectory`, strict filesystem protections, network-only address families, restart-on-failure, and a persistent database at `/var/lib/elliott-wave-discord-bot/profile-bot.db`.
- Add a manual production workflow that tests the bot, builds a Linux dependency bundle, uploads an immutable release, sends secrets only through SSH stdin, atomically switches the current symlink, restarts the service, verifies Discord readiness from the service journal, and rolls back code/unit/environment on failure.
- Add a bounded runtime renderer that validates the stdin JSON and emits only allowlisted environment keys. The initial database is supplied as a GitHub secret and installed only when no production database exists.

## Failure handling

- Invalid or missing secrets fail before upload.
- A failed install/restart/Discord login restores the previous symlink, unit, and environment file.
- Existing persistent database content is never overwritten by later deployments.
- Release artifacts and transaction files are removed after success or failure.
