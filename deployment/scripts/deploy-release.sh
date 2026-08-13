#!/usr/bin/env bash
set -Eeuo pipefail

release_dir=${1:?release directory is required}
release_id=${2:?release id is required}
site_root=/var/www/elliott-wave
gateway_root=/opt/elliott-wave-gateway
migration_root=/opt/elliott-wave-migrations
backup_root=/var/backups/elliott-wave/actions
backup_dir="${backup_root}/${release_id}"

if [[ ! -f "${release_dir}/index.html" || ! -d "${release_dir}/community" ]]; then
  echo "release candidate is incomplete" >&2
  exit 1
fi

sudo install -d -m 0750 "${backup_dir}"
sudo tar -C "${site_root}" -czf "${backup_dir}/site.tar.gz" .
sudo tar -C "${gateway_root}" -czf "${backup_dir}/gateway.tar.gz" .

rollback() {
  status=$?
  trap - ERR
  echo "deployment failed; restoring ${release_id}" >&2
  restore_dir="${backup_dir}/restore"
  sudo install -d -m 0750 "${restore_dir}/site" "${restore_dir}/gateway"
  sudo tar -C "${restore_dir}/site" -xzf "${backup_dir}/site.tar.gz"
  sudo tar -C "${restore_dir}/gateway" -xzf "${backup_dir}/gateway.tar.gz"
  sudo rsync -a --delete "${restore_dir}/site/" "${site_root}/"
  sudo rsync -a --delete "${restore_dir}/gateway/" "${gateway_root}/"
  sudo rm -rf -- "${restore_dir}"
  sudo systemctl restart elliott-wave-gateway || true
  exit "${status}"
}
trap rollback ERR

for page in index.html elliott-wave-preview.html elliott-wave-knowledge-tree.html; do
  sudo install -m 0644 "${release_dir}/${page}" "${site_root}/${page}"
done

for directory in assets community admin workbench; do
  sudo install -d -m 0755 "${site_root}/${directory}"
  sudo rsync -a --delete "${release_dir}/${directory}/" "${site_root}/${directory}/"
done

sudo install -d -m 0755 "${gateway_root}" "${migration_root}"
sudo rsync -a --delete "${release_dir}/ai-gateway/" "${gateway_root}/"
sudo rsync -a --delete "${release_dir}/supabase/migrations/" "${migration_root}/"

sudo systemctl restart elliott-wave-gateway
sudo systemctl is-active --quiet elliott-wave-gateway
sudo nginx -t
curl --fail --silent --show-error --retry 3 http://127.0.0.1/ > /dev/null

trap - ERR
sudo find "${backup_root}" -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf -- {} +
echo "deployed ${release_id}"
