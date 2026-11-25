#!/usr/bin/env bash
set -Eeuo pipefail

configurator=${1:-}
backup_file=${2:-}
expected_sha=${3:-}

[[ "$configurator" =~ ^\./wavekb-discord-config-[1-9][0-9]*-[1-9][0-9]*\.mjs$ ]]
[[ "$backup_file" =~ ^/var/backups/wavekb-next-production/discord-config-[1-9][0-9]*-[1-9][0-9]*\.env$ ]]
[[ "$expected_sha" =~ ^[0-9a-f]{40}$ ]]
sudo -n true
sudo -n test -f /etc/elliott-wave/gateway.env
sudo -n test -f /etc/wavekb/next-preview.env
sudo -n test -d /var/backups/wavekb-next-production

receipt=$(sudo -n /usr/bin/node -- "$configurator" apply \
  --gateway-env /etc/elliott-wave/gateway.env \
  --next-env /etc/wavekb/next-preview.env \
  --backup-file "$backup_file")
new_hash=$(printf '%s' "$receipt" | /usr/bin/node --input-type=module -e '
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => input += chunk);
  process.stdin.on("end", () => {
    try {
      const receipt = JSON.parse(input);
      if (receipt.status !== "configured" || !/^[0-9a-f]{64}$/.test(receipt.newHash)) throw new Error();
      process.stdout.write(receipt.newHash);
    } catch { process.exitCode = 1; }
  });
')
[[ "$new_hash" =~ ^[0-9a-f]{64}$ ]]

rollback() {
  status=$?
  trap - ERR
  sudo -n /usr/bin/node -- "$configurator" rollback \
    --next-env /etc/wavekb/next-preview.env \
    --backup-file "$backup_file" \
    --expected-hash "$new_hash" >/dev/null
  sudo -n systemctl restart wavekb-next-preview.service
  test "$(sudo -n systemctl is-active wavekb-next-preview.service)" = active
  exit "$status"
}
trap rollback ERR

sudo -n systemctl restart wavekb-next-preview.service
test "$(sudo -n systemctl is-active wavekb-next-preview.service)" = active

healthy=0
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if EXPECTED_SHA="$expected_sha" /usr/bin/node --input-type=module -e '
    try {
      const response = await fetch("https://wavekb.com/api/health", {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      const body = await response.json();
      if (!response.ok || body.ok !== true || body.deployment !== process.env.EXPECTED_SHA) process.exit(1);
    } catch { process.exit(1); }
  '; then
    healthy=1
    break
  fi
  sleep 2
done
test "$healthy" -eq 1

/usr/bin/node --input-type=module -e '
  try {
    const response = await fetch("https://wavekb.com/api/integrations/discord/link", {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status !== 401) process.exit(1);
  } catch { process.exit(1); }
'

trap - ERR
printf '%s\n' '{"status":"configured_and_verified"}'
