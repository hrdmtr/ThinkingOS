#!/usr/bin/env bash
#
# Thinking OS - VPS側バックアップスクリプト
#
# 実行主体: VPS上、thinkingosユーザーのcronから定期実行する想定
#          （docs/vps-architecture.md 7章: 宛先はユーザー自身のPC。
#           このスクリプトはVPS側でのスナップショット作成＋暗号化のみを担当し、
#           VPS→PCへの送信は行わない。取得は pull-backup.sh 側からプル型で行う）。
#
# 処理内容:
#   1. sqlite3 の .backup コマンドでSQLiteのオンラインバックアップを取得
#      （運用中のDBファイルを直接cpするより安全。書き込み中でも一貫性のあるコピーが取れる）
#   2. age で公開鍵暗号化（秘密鍵はVPSに置かない。手元PC側にのみ秘密鍵を保管する）
#   3. 古い世代を削除（デフォルトで直近7世代のみ保持）
#
# --- crontabへの登録例（thinkingosユーザーで `crontab -e`） ---
#   # 毎日 3:00 (VPSのローカルタイム) にバックアップを実行し、ログを残す
#   0 3 * * * /opt/thinking-os/current/infra/backup/backup.sh >> /opt/thinking-os/shared/backups/backup.log 2>&1
#
# 事前準備（初回のみ、手動）:
#   - 手元PCで age の鍵ペアを生成する:  age-keygen -o thinking-os-backup-key.txt
#     出力される "public key: age1..." をこのスクリプトの AGE_RECIPIENT、
#     または環境変数 THINKING_OS_BACKUP_AGE_RECIPIENT に設定する。
#     秘密鍵ファイル(thinking-os-backup-key.txt)はVPSには置かず、手元PCで安全に保管すること。

set -euo pipefail

# ============================================================
# 設定
# ============================================================

# 暗号化に使うageの公開鍵（受信者）。
# ハードコードしたくない場合は環境変数 THINKING_OS_BACKUP_AGE_RECIPIENT を
# /opt/thinking-os/shared/.env 等で設定し、下の行はそのままにしておけばよい。
AGE_RECIPIENT="${THINKING_OS_BACKUP_AGE_RECIPIENT:-age1REPLACE_WITH_YOUR_PUBLIC_KEY}"

# バックアップ対象のSQLiteファイル（.env.example の DATABASE_PATH と一致させること）
DB_PATH="${THINKING_OS_DB_PATH:-/opt/thinking-os/shared/data/thinkingos.sqlite}"

# 暗号化済みスナップショットの保存先（pull-backup.sh がここから取得する）
BACKUP_DIR="${THINKING_OS_BACKUP_DIR:-/opt/thinking-os/shared/backups}"

# 保持する世代数（これを超えた古いものから削除）
RETENTION_COUNT="${THINKING_OS_BACKUP_RETENTION:-7}"

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
TMP_PLAIN="$(mktemp)"
ENCRYPTED_FILE="${BACKUP_DIR}/thinkingos_${TIMESTAMP}.sqlite.age"

cleanup() {
  # 平文の一時ファイルは必ず消す（失敗時・正常終了時とも）
  rm -f "${TMP_PLAIN}"
}
trap cleanup EXIT

# ============================================================
# 事前チェック
# ============================================================

if [[ "${AGE_RECIPIENT}" == *"REPLACE_WITH_YOUR_PUBLIC_KEY"* ]]; then
  echo "エラー: age の公開鍵が未設定です。THINKING_OS_BACKUP_AGE_RECIPIENT を設定するか、" >&2
  echo "        このスクリプト内の AGE_RECIPIENT を書き換えてください。" >&2
  exit 1
fi

if [[ ! -f "${DB_PATH}" ]]; then
  echo "エラー: DBファイルが見つかりません: ${DB_PATH}" >&2
  exit 1
fi

command -v sqlite3 >/dev/null 2>&1 || { echo "エラー: sqlite3 が見つかりません" >&2; exit 1; }
command -v age >/dev/null 2>&1 || { echo "エラー: age が見つかりません" >&2; exit 1; }

mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

# ============================================================
# 1. SQLiteオンラインバックアップ
# ============================================================

echo "[$(date -Iseconds)] SQLiteバックアップ開始: ${DB_PATH}"
sqlite3 "${DB_PATH}" ".backup '${TMP_PLAIN}'"

# ============================================================
# 2. age で暗号化
# ============================================================

echo "[$(date -Iseconds)] 暗号化: ${ENCRYPTED_FILE}"
age -r "${AGE_RECIPIENT}" -o "${ENCRYPTED_FILE}" "${TMP_PLAIN}"
chmod 600 "${ENCRYPTED_FILE}"

# ============================================================
# 3. 古い世代のローテーション（直近 RETENTION_COUNT 件だけ残す）
# ============================================================

echo "[$(date -Iseconds)] ローテーション（保持世代数: ${RETENTION_COUNT}）"
# shellcheck disable=SC2012
ls -1t "${BACKUP_DIR}"/thinkingos_*.sqlite.age 2>/dev/null \
  | tail -n +"$((RETENTION_COUNT + 1))" \
  | while IFS= read -r old_file; do
      echo "  削除: ${old_file}"
      rm -f -- "${old_file}"
    done

echo "[$(date -Iseconds)] バックアップ完了: ${ENCRYPTED_FILE}"
