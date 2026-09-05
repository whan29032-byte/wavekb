# Manual rollback of an accepted production release

These are implemented operator commands, not commands executed during development. Run them only after explicitly authorizing a production rollback. They apply to releases created by `deploy-release.mjs`, which retains its uploaded runner and `/var/backups/wavekb-next-production/<release-id>/` metadata.

## Automatic and manual commands are intentionally different

- `rollback SHA RUN_ID RUN_ATTEMPT` is the failed-job recovery command. It does nothing when the release is already `accepted` or `rolled-back`.
- `rollback-accepted SHA RUN_ID RUN_ATTEMPT --confirm-previous-version PREVIOUS_SHA` is the explicit manual command. It requires `accepted` metadata, the exact candidate still at `current`, and an operator confirmation equal to the saved previous SHA. It cannot overwrite a different release.
- The manual command does **not** require the bad current version to be healthy. It restores the original service file and exact previous code, leaves the environment file unchanged, restarts the service and requires the restored health endpoint to report the saved previous SHA.

## Executable operator procedure

On the server, open Bash as the same deployment account whose directory contains the uploaded `wavekb-deploy-<release-id>.mjs`. Obtain the SHA, run ID and attempt from the release report. These identify the accepted release being reversed, not the desired previous release.

```bash
read -r -p 'Accepted release SHA: ' rollback_release_sha
read -r -p 'Accepted GitHub run ID: ' rollback_run_id
read -r -p 'Accepted run attempt: ' rollback_run_attempt
rollback_release_id="${rollback_release_sha}-${rollback_run_id}-${rollback_run_attempt}"
[[ "$rollback_release_id" =~ ^[0-9a-f]{40}-[1-9][0-9]*-[1-9][0-9]*$ ]] || exit 1

# Read only non-secret rollback identity fields; do not print the environment.
sudo /usr/bin/node -e '
  const fs = require("node:fs");
  const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  console.log(JSON.stringify({ phase: m.phase, releaseId: m.releaseId,
    currentSha: m.sha, previousVersion: m.previousVersion,
    previousRelease: m.previousRelease }, null, 2));
' "/var/backups/wavekb-next-production/${rollback_release_id}/rollback.json"

# Review that previousVersion is the release you intend to restore.
read -r -p 'Confirm the displayed previousVersion SHA: ' rollback_previous_sha
sudo /usr/bin/node "./wavekb-deploy-${rollback_release_id}.mjs" \
  rollback-accepted "$rollback_release_sha" "$rollback_run_id" "$rollback_run_attempt" \
  --confirm-previous-version "$rollback_previous_sha"
```

Exit status zero indicates that the runner restored and verified the previous version. Then run the normal read-only production browser/asset acceptance before declaring the site recovered. This operation neither migrates nor rolls back the database, Nginx, gateway, uploads or environment settings.

## Interrupted restoration

Before touching the service, the runner records `rolling-back`. If an explicitly authorized restoration is interrupted, inspect the same metadata first. Only when it says `rolling-back`, resume that transaction using:

```bash
sudo /usr/bin/node "./wavekb-deploy-${rollback_release_id}.mjs" \
  rollback "$rollback_release_sha" "$rollback_run_id" "$rollback_run_attempt"
```

The current link must still target either that candidate or its recorded previous release. If it targets anything else, or backup/health verification fails, stop for operator investigation. Do not edit `rollback.json` to bypass the accepted-state guard.
