#!/usr/bin/env bash
set -Eeuo pipefail

if [ "$#" -ne 4 ]; then
  echo 'usage: deploy-discord-bot-production.sh ARCHIVE UNIT RENDERER RELEASE_ID' >&2
  exit 2
fi

archive=$1
unit_source=$2
renderer=$3
release_id=$4
service=elliott-wave-discord-bot.service
release_root=/opt/elliott-wave-discord-bot
release_dir="${release_root}/releases/${release_id}"
current_link="${release_root}/current"
environment_file=/etc/elliott-wave/discord-bot.env
database_host_path=/var/lib/private/elliott-wave-discord-bot/profile-bot.db
backup_root="/var/backups/elliott-wave-discord-bot/${release_id}"

[[ "$release_id" =~ ^[0-9a-f]{40}-[1-9][0-9]*-[1-9][0-9]*$ ]]
for input_file in "$archive" "$unit_source" "$renderer"; do
  test -f "$input_file"
  resolved=$(readlink -f "$input_file")
  case "$resolved" in "$HOME"/*) ;; *) exit 2 ;; esac
done

transaction_dir=$(mktemp -d)
payload_file="${transaction_dir}/payload.json"
candidate_environment="${transaction_dir}/discord-bot.env"
candidate_database="${transaction_dir}/profile-bot.db"
database_seeded=0
rollback_ready=0

cleanup() {
  rm -rf -- "$transaction_dir"
}
trap cleanup EXIT

cat > "$payload_file"
/usr/bin/node "$renderer" "$payload_file" "$candidate_environment" "$candidate_database"
test -s "$candidate_environment"

if tar -tzf "$archive" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  echo 'Unsafe archive path.' >&2
  exit 1
fi

sudo test ! -e "$release_dir"
sudo install -d -m 0755 "${release_root}/releases"
sudo install -d -m 0750 "$backup_root"

if sudo test -L "$current_link"; then
  previous_release=$(sudo readlink -f "$current_link")
  sudo test -d "$previous_release"
  printf '%s\n' "$previous_release" | sudo tee "${backup_root}/previous-release" >/dev/null
elif sudo test -e "$current_link"; then
  echo 'Current release is not a symlink.' >&2
  exit 1
else
  previous_release=''
  sudo touch "${backup_root}/previous-release.missing"
fi

if sudo test -f "/etc/systemd/system/${service}"; then
  sudo cp --preserve=mode,ownership,timestamps "/etc/systemd/system/${service}" "${backup_root}/${service}"
else
  sudo touch "${backup_root}/${service}.missing"
fi
if sudo test -f "$environment_file"; then
  sudo cp --preserve=mode,ownership,timestamps "$environment_file" "${backup_root}/discord-bot.env"
else
  sudo touch "${backup_root}/discord-bot.env.missing"
fi

if sudo systemctl is-active --quiet "$service"; then
  service_was_active=active
else
  service_was_active=inactive
fi
service_was_enabled=$(sudo systemctl is-enabled "$service" 2>/dev/null || true)
case "$service_was_enabled" in
  enabled|disabled|static|indirect|masked) ;;
  *) service_was_enabled=missing ;;
esac

sudo install -d -m 0755 "$release_dir"
sudo tar -xzf "$archive" -C "$release_dir"
sudo test -f "${release_dir}/index.js"
sudo test -f "${release_dir}/package.json"
sudo test -d "${release_dir}/node_modules"
sudo test ! -e "${release_dir}/.env"
sudo test ! -e "${release_dir}/data"
sudo chown -R root:root "$release_dir"
sudo chmod -R a+rX "$release_dir"

rollback_ready=1
rollback() {
  status=$?
  trap - ERR
  if [ "$rollback_ready" -eq 1 ]; then
    if [ -n "$previous_release" ]; then
      rollback_link="${release_root}/.rollback-${release_id}"
      sudo ln -sfn "$previous_release" "$rollback_link"
      sudo mv -Tf "$rollback_link" "$current_link"
    else
      sudo rm -f "$current_link"
    fi

    if sudo test -f "${backup_root}/${service}.missing"; then
      sudo systemctl disable --now "$service" >/dev/null 2>&1 || true
      sudo rm -f "/etc/systemd/system/${service}"
    else
      sudo cp --preserve=mode,ownership,timestamps "${backup_root}/${service}" "/etc/systemd/system/${service}"
    fi
    if sudo test -f "${backup_root}/discord-bot.env.missing"; then
      sudo rm -f "$environment_file"
    else
      sudo cp --preserve=mode,ownership,timestamps "${backup_root}/discord-bot.env" "$environment_file"
    fi
    if [ "$database_seeded" -eq 1 ]; then
      sudo rm -f "$database_host_path" "${database_host_path}-shm" "${database_host_path}-wal"
    fi

    sudo systemctl daemon-reload
    if ! sudo test -f "${backup_root}/${service}.missing"; then
      case "$service_was_enabled" in
        enabled) sudo systemctl enable "$service" >/dev/null ;;
        disabled|indirect) sudo systemctl disable "$service" >/dev/null ;;
        masked) sudo systemctl mask "$service" >/dev/null ;;
        static|missing) ;;
      esac
      if [ "$service_was_active" = active ]; then
        sudo systemctl restart "$service"
      else
        sudo systemctl stop "$service" >/dev/null 2>&1 || true
      fi
    fi
    sudo rm -rf "$release_dir"
  fi
  exit "$status"
}
trap rollback ERR

sudo install -d -m 0755 /etc/elliott-wave
environment_candidate="/etc/elliott-wave/.discord-bot.env-${release_id}"
sudo test ! -e "$environment_candidate"
sudo install -m 0600 "$candidate_environment" "$environment_candidate"
sudo mv -Tf "$environment_candidate" "$environment_file"

if ! sudo test -e "$database_host_path"; then
  test -s "$candidate_database"
  sudo install -d -m 0700 /var/lib/private/elliott-wave-discord-bot
  sudo install -m 0600 "$candidate_database" "$database_host_path"
  database_seeded=1
fi

sudo install -m 0644 "$unit_source" "/etc/systemd/system/${service}"
candidate_link="${release_root}/.candidate-${release_id}"
sudo ln -sfn "$release_dir" "$candidate_link"
sudo mv -Tf "$candidate_link" "$current_link"
sudo systemctl daemon-reload

started_at=$(date --iso-8601=seconds)
sudo systemctl enable --now elliott-wave-discord-bot.service
ready=0
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if sudo systemctl is-active --quiet "$service" \
    && sudo journalctl -u elliott-wave-discord-bot.service --since "$started_at" --no-pager -o cat | grep -F '已上线' >/dev/null; then
    ready=1
    break
  fi
  sleep 2
done
test "$ready" -eq 1
test "$(sudo systemctl is-active "$service")" = active

trap - ERR
rm -f -- "$archive" "$unit_source" "$renderer"
