#!/usr/bin/env bash
#
# Thinking OS - 手元PC側バックアップ取得スクリプト
#
# 実行主体: このリポジトリをcloneしている手元PC（VPSではない）。
#          docs/vps-architecture.md 7章の方針（プル型。VPS側から外部へ送信する
#          経路を増やさない）に従い、VPS上に作成済みの暗号化済みスナップショット
#          （infra/backup/backup.sh が生成したもの）をこちら側から取りに行く。
#
# 前提:
#   - VPS側で infra/backup/backup.sh がcronで定期実行済み（暗号化済みファイルが
#     /opt/thinking-os/shared/backups/ に溜まっている）
#   - rsync（推奨）または scp が使えること。rsyncがあれば差分転送で効率的。
#   - VPSへSSH公開鍵でログインできること（バックアップ取得専用の鍵を分けてもよい。
#     read-onlyにしたい場合は command="rsync --server ..." 等で
#     authorized_keys 側を制限することも検討する）
#
# --- 定期実行の例（手元PCのcron / launchd / タスクスケジューラ等に登録） ---
#   例: 手元PCがLinux/macOSで常時電源が入っている場合、毎日 9:00 に取得:
#     0 9 * * * /path/to/ThinkingOS/infra/backup/pull-backup.sh >> ~/thinking-os-backups/pull.log 2>&1
#   ノートPC等で常時起動していない場合は、思い出したときに手動実行でもよい
#   （直近7世代がVPS側に残っているため、多少間隔が空いても取りこぼしにくい設計:
#    infra/backup/backup.sh の RETENTION_COUNT を参照）。
#
# 復号方法（取得後、必要なときに手元で）:
#   age -d -i thinking-os-backup-key.txt -o thinkingos_復元先.sqlite \
#       thinkingos_20260101_030000.sqlite.age
#   （thinking-os-backup-key.txt は age-keygen で作った秘密鍵ファイル。VPSには置かない）

set -euo pipefail

# ============================================================
# 設定（環境に合わせて書き換えるか、環境変数で上書きする）
# ============================================================

VPS_HOST="${THINKING_OS_VPS_HOST:-<YOUR_VPS_IP_OR_HOSTNAME>}"
VPS_USER="${THINKING_OS_VPS_USER:-thinkingos}"
VPS_SSH_PORT="${THINKING_OS_VPS_SSH_PORT:-22}"
# VPS側のバックアップ置き場（infra/backup/backup.sh の BACKUP_DIR と一致させること）
REMOTE_BACKUP_DIR="${THINKING_OS_REMOTE_BACKUP_DIR:-/opt/thinking-os/shared/backups}"

# 取得先（手元PC側）。リポジトリ配下ではなく、リポジトリ外の場所を推奨
# （誤ってgit管理下に置かないため。デフォルトはホームディレクトリ配下）。
LOCAL_BACKUP_DIR="${THINKING_OS_LOCAL_BACKUP_DIR:-$HOME/thinking-os-backups}"

# SSH秘密鍵を明示指定したい場合はここに書くか、ssh-agent/~/.ssh/configに任せる
# SSH_KEY_OPT=(-i "$HOME/.ssh/thinking_os_backup_ed25519")
SSH_KEY_OPT=()

# ============================================================
# 事前チェック
# ============================================================

if [[ "${VPS_HOST}" == "<YOUR_VPS_IP_OR_HOSTNAME>" ]]; then
  echo "エラー: VPS_HOST が未設定です。THINKING_OS_VPS_HOST を設定するか、" >&2
  echo "        このスクリプト内の VPS_HOST を書き換えてください。" >&2
  exit 1
fi

mkdir -p "${LOCAL_BACKUP_DIR}"

# ============================================================
# 取得（rsyncが使えればrsync、なければscpにフォールバック）
# ============================================================

if command -v rsync >/dev/null 2>&1; then
  echo "rsyncで取得します: ${VPS_USER}@${VPS_HOST}:${REMOTE_BACKUP_DIR}/ -> ${LOCAL_BACKUP_DIR}/"
  rsync -avz --progress \
    -e "ssh -p ${VPS_SSH_PORT} ${SSH_KEY_OPT[*]:-}" \
    "${VPS_USER}@${VPS_HOST}:${REMOTE_BACKUP_DIR}/*.sqlite.age" \
    "${LOCAL_BACKUP_DIR}/"
else
  echo "rsyncが見つからないため scp で取得します（差分転送はできません）"
  # shellcheck disable=SC2029
  scp -P "${VPS_SSH_PORT}" "${SSH_KEY_OPT[@]}" \
    "${VPS_USER}@${VPS_HOST}:${REMOTE_BACKUP_DIR}/*.sqlite.age" \
    "${LOCAL_BACKUP_DIR}/"
fi

echo "取得完了: ${LOCAL_BACKUP_DIR}"
ls -lh "${LOCAL_BACKUP_DIR}" | tail -n 10

echo ""
echo "復号する場合は以下のように実行してください（秘密鍵ファイルは各自の保管場所に置き換える）:"
echo "  age -d -i /path/to/thinking-os-backup-key.txt -o restored.sqlite <取得したファイル名>"
