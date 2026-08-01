#!/usr/bin/env bash
#
# Thinking OS - VPS初回セットアップスクリプト
#
# 対象: 新規に用意した Ubuntu 24.04 LTS の VPS 1台。
# 実行方法: root で1回だけ実行する（べき等性はある程度考慮しているが、
#           本番運用中のVPSに対する再実行は想定していない）。
#
#   scp infra/provisioning/setup.sh root@<YOUR_VPS_IP>:/root/setup.sh
#   ssh root@<YOUR_VPS_IP>
#   # --- ここで必ず一度中身を読み、下記「編集必須」セクションの値を書き換えてから実行する ---
#   nano /root/setup.sh
#   chmod +x /root/setup.sh
#   /root/setup.sh
#
# 実行前に必ず確認すること:
#   1. 下の CONFIG セクションの ADMIN_SSH_PUBLIC_KEY を、自分の実際の公開鍵に置き換えたか。
#      → これを忘れて SSH ハードニング（PasswordAuthentication no）まで進むと、
#        鍵なしでは二度とログインできなくなる（VPSプロバイダのコンソールを使うしかなくなる）。
#   2. DOMAIN をこのVPSに向ける予定の実際のドメインに置き換えたか
#      （Caddyの自動TLS取得に必要。DNSのAレコードが先にVPSのIPを指している必要がある）。
#   3. このスクリプトは秘密情報を一切含まない。APIキー・Basic認証パスワード等は
#      このスクリプトの実行後、/opt/thinking-os/shared/.env に別途手動で設置する
#      （.env.example 参照。このファイルはgit管理外）。
#
# 参照: docs/vps-architecture.md（1, 2, 3, 4, 6章）

set -euo pipefail

# ============================================================
# CONFIG（編集必須）
# ============================================================

# サービスユーザー名。docs/vps-architecture.md 6章の決定に合わせて thinkingos 固定。
APP_USER="thinkingos"

# デプロイ・アプリの配置ルート
APP_ROOT="/opt/thinking-os"

# Caddyが自動TLS取得の対象にするドメイン。実際のドメインに書き換えること。
DOMAIN="example.com"

# GitHub Actions からのデプロイ（appleboy/ssh-action）で使う公開鍵、および
# 管理者が手動ログインする際の公開鍵をここに書く（複数行可、1行1鍵）。
# 生成例（手元PCで）: ssh-keygen -t ed25519 -C "thinking-os-deploy"
# ここには秘密鍵を絶対に書かないこと。
ADMIN_SSH_PUBLIC_KEY="ssh-ed25519 AAAA...replace-with-your-actual-public-key... comment"

# SSHのポート番号（変更しない場合は22のままでよい。ufwのルールと連動させること）
SSH_PORT="22"

# ============================================================
# 0. 前提チェック
# ============================================================

if [[ "$(id -u)" -ne 0 ]]; then
  echo "このスクリプトは root で実行してください（例: sudo bash setup.sh）" >&2
  exit 1
fi

if [[ "$ADMIN_SSH_PUBLIC_KEY" == *"replace-with-your-actual-public-key"* ]]; then
  echo "CONFIG セクションの ADMIN_SSH_PUBLIC_KEY を実際の公開鍵に書き換えてから再実行してください。" >&2
  exit 1
fi

echo "=== Thinking OS VPS セットアップを開始します ==="
echo "APP_USER=${APP_USER} / APP_ROOT=${APP_ROOT} / DOMAIN=${DOMAIN}"
read -r -p "上記の内容で続行しますか？ [y/N] " CONFIRM
if [[ "${CONFIRM}" != "y" && "${CONFIRM}" != "Y" ]]; then
  echo "中止しました。"
  exit 1
fi

# ============================================================
# 1. OSパッケージ更新・基本ツール
# ============================================================

echo "--- 1. apt更新・基本パッケージ ---"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y \
  curl \
  ca-certificates \
  gnupg \
  git \
  sqlite3 \
  age \
  ufw \
  fail2ban \
  unattended-upgrades

# ============================================================
# 2. Node.js 22系（NodeSource公式リポジトリ）
#    docs/vps-architecture.md 1章: nvmは使わない（systemdからのPATH解決が壊れやすいため）
# ============================================================

echo "--- 2. Node.js 22系インストール ---"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
else
  echo "Node.js 22系は既にインストール済みのためスキップします。"
fi
node -v
npm -v

# ============================================================
# 3. Caddy（公式リポジトリ）
# ============================================================

echo "--- 3. Caddyインストール ---"
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
else
  echo "Caddyは既にインストール済みのためスキップします。"
fi

# ============================================================
# 4. アプリ専用の非rootユーザー作成
#    docs/vps-architecture.md 6章
# ============================================================

echo "--- 4. ユーザー作成: ${APP_USER} ---"
if ! id "${APP_USER}" >/dev/null 2>&1; then
  useradd -r -m -s /bin/bash "${APP_USER}"
else
  echo "ユーザー ${APP_USER} は既に存在するためスキップします。"
fi

# デプロイ・管理者の鍵で thinkingos ユーザーにSSHログインできるようにする
# （appleboy/ssh-actionはこのユーザー・鍵でVPSに接続する想定）
install -d -m 700 -o "${APP_USER}" -g "${APP_USER}" "/home/${APP_USER}/.ssh"
touch "/home/${APP_USER}/.ssh/authorized_keys"
if ! grep -qxF "${ADMIN_SSH_PUBLIC_KEY}" "/home/${APP_USER}/.ssh/authorized_keys"; then
  echo "${ADMIN_SSH_PUBLIC_KEY}" >> "/home/${APP_USER}/.ssh/authorized_keys"
fi
chmod 600 "/home/${APP_USER}/.ssh/authorized_keys"
chown -R "${APP_USER}:${APP_USER}" "/home/${APP_USER}/.ssh"

# ============================================================
# 5. ディレクトリ構成・権限
#    docs/vps-architecture.md 6章
# ============================================================

echo "--- 5. ディレクトリ作成 ---"
install -d -o "${APP_USER}" -g "${APP_USER}" -m 750 "${APP_ROOT}"
install -d -o "${APP_USER}" -g "${APP_USER}" -m 750 "${APP_ROOT}/current"
install -d -o "${APP_USER}" -g "${APP_USER}" -m 750 "${APP_ROOT}/shared"
install -d -o "${APP_USER}" -g "${APP_USER}" -m 700 "${APP_ROOT}/shared/data"
install -d -o "${APP_USER}" -g "${APP_USER}" -m 700 "${APP_ROOT}/shared/backups"

# .env はこの時点では空のプレースホルダのみ作成する。中身は手動で設置すること（.env.example参照）。
if [[ ! -f "${APP_ROOT}/shared/.env" ]]; then
  install -o "${APP_USER}" -g "${APP_USER}" -m 600 /dev/null "${APP_ROOT}/shared/.env"
  echo "# ここに本番用の環境変数を設置してください（.env.example を参照）" \
    > "${APP_ROOT}/shared/.env"
  chown "${APP_USER}:${APP_USER}" "${APP_ROOT}/shared/.env"
  chmod 600 "${APP_ROOT}/shared/.env"
fi

# CaddyがDOMAIN/Basic認証情報を読み込むための環境ファイル（Caddyfile参照）
if [[ ! -f "${APP_ROOT}/shared/caddy.env" ]]; then
  cat > "${APP_ROOT}/shared/caddy.env" <<EOF
# Caddy用の環境変数。infra/Caddyfile の {\$VAR} から参照される。
# BASIC_AUTH_PASSWORD_HASH は平文パスワードではなく \`caddy hash-password\` の出力を使うこと。
DOMAIN=${DOMAIN}
BASIC_AUTH_USER=thinkingos
BASIC_AUTH_PASSWORD_HASH=REPLACE_WITH_OUTPUT_OF_caddy_hash-password
EOF
  chmod 600 "${APP_ROOT}/shared/caddy.env"
fi

# fail2banの検知対象になるCaddyのアクセスログ置き場
install -d -o caddy -g caddy -m 750 /var/log/caddy

# ============================================================
# 6. sudoers（デプロイ用ユーザーに許可するコマンドをフルパス完全一致で固定）
#    docs/vps-architecture.md 4章
# ============================================================

echo "--- 6. sudoers設定 ---"
SUDOERS_FILE="/etc/sudoers.d/${APP_USER}"
cat > "${SUDOERS_FILE}" <<EOF
# Thinking OS デプロイ用。ワイルドカード不可・フルパス完全一致のみ許可。
${APP_USER} ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart thinking-os
EOF
chmod 440 "${SUDOERS_FILE}"
visudo -c -f "${SUDOERS_FILE}"

# ============================================================
# 7. ufw（22/80/443のみ開放）
#    docs/vps-architecture.md 4章
# ============================================================

echo "--- 7. ufw設定 ---"
ufw default deny incoming
ufw default allow outgoing
ufw allow "${SSH_PORT}/tcp" comment 'SSH'
ufw allow 80/tcp comment "HTTP (Let's Encrypt / Caddy)"
ufw allow 443/tcp comment 'HTTPS'
# SSHの発信元IPを絞れる場合は上のSSHルールをコメントアウトし、代わりに以下を使う：
#   ufw allow from <YOUR_HOME_OR_OFFICE_IP> to any port ${SSH_PORT} proto tcp comment 'SSH (restricted)'
ufw --force enable
ufw status verbose

# ============================================================
# 8. fail2ban
#    docs/vps-architecture.md 4章:
#    Caddyのアクセスログから401（認証失敗）の連続発生を検知してBAN
#    (maxretry=5, findtime=600, bantime=3600)。sshdのjailも有効化。
# ============================================================

echo "--- 8. fail2ban設定 ---"

# --- 8-1. Caddy Basic認証失敗を検知するfilter ---
# Caddyの構造化(JSON)アクセスログの1行を対象に、
# 同一行内に "status":401 と "remote_ip":"<IP>" が含まれるものを検知する。
# ログの出力先・形式を変える場合はこのfilterも合わせて見直すこと。
cat > /etc/fail2ban/filter.d/caddy-auth.conf <<'EOF'
# Caddy JSON access log 内の 401 (Basic認証失敗) を検知する
[Definition]
failregex = ^.*"remote_ip":"<HOST>".*"status":401.*$
ignoreregex =
EOF

# --- 8-2. jail定義（Caddy用 + sshd有効化） ---
cat > /etc/fail2ban/jail.d/thinking-os.local <<EOF
[sshd]
enabled = true
port    = ${SSH_PORT}
maxretry = 5
findtime = 600
bantime  = 3600

[caddy-auth]
enabled  = true
port     = http,https
filter   = caddy-auth
logpath  = /var/log/caddy/access.log
maxretry = 5
findtime = 600
bantime  = 3600
EOF

systemctl enable fail2ban
systemctl restart fail2ban

echo "fail2ban filter の妥当性は、初回デプロイ・Caddy起動後に以下で確認できます:"
echo "  fail2ban-regex /var/log/caddy/access.log /etc/fail2ban/filter.d/caddy-auth.conf"

# ============================================================
# 9. SSHハードニング
#    docs/vps-architecture.md 4章: PasswordAuthentication no, PermitRootLogin no
#    注意: ADMIN_SSH_PUBLIC_KEY が正しく authorized_keys に入っていることを
#          このステップの前に必ず確認すること（このスクリプト内で自動確認済みだが、
#          万一に備えて別ターミナルで一度ログインテストしてから本番適用するのが安全）。
# ============================================================

echo "--- 9. SSHハードニング ---"
SSHD_DROPIN="/etc/ssh/sshd_config.d/99-thinking-os.conf"
cat > "${SSHD_DROPIN}" <<EOF
# Thinking OS - SSHハードニング (docs/vps-architecture.md 4章)
PasswordAuthentication no
PermitRootLogin no
KbdInteractiveAuthentication no
EOF

# 設定の文法チェックをしてから反映する（壊れた設定でsshdが再起動に失敗するのを防ぐ）
sshd -t
systemctl reload ssh || systemctl reload sshd

# ============================================================
# 10. systemd ユニット・Caddy設定の設置
#     アプリ本体はこの時点ではまだデプロイされていないため、
#     thinking-os.service は enable のみ行い、start はしない
#     （初回デプロイ完了後にGitHub Actions経由のsystemctl restartで起動する）。
# ============================================================

echo "--- 10. systemd / Caddy 設定設置 ---"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

if [[ -f "${REPO_ROOT}/infra/systemd/thinking-os.service" ]]; then
  cp "${REPO_ROOT}/infra/systemd/thinking-os.service" /etc/systemd/system/thinking-os.service
  systemctl daemon-reload
  systemctl enable thinking-os
else
  echo "警告: infra/systemd/thinking-os.service が見つかりませんでした。手動で設置してください。"
fi

if [[ -f "${REPO_ROOT}/infra/Caddyfile" ]]; then
  cp "${REPO_ROOT}/infra/Caddyfile" /etc/caddy/Caddyfile

  # Caddyのsystemdユニットに、shared/caddy.env を読み込むdrop-inを追加する
  install -d /etc/systemd/system/caddy.service.d
  cat > /etc/systemd/system/caddy.service.d/override.conf <<EOF
[Service]
EnvironmentFile=${APP_ROOT}/shared/caddy.env
EOF
  systemctl daemon-reload
  systemctl enable caddy
  # BASIC_AUTH_PASSWORD_HASH が未設定のままだとCaddyの起動に失敗するため、
  # ここでは reload/restart せず案内のみ行う（下記の手動作業を参照）。
else
  echo "警告: infra/Caddyfile が見つかりませんでした。手動で設置してください。"
fi

# ============================================================
# 完了
# ============================================================

cat <<EOF

=== セットアップスクリプト完了 ===

このあと手動で必要な作業:

1. ${APP_ROOT}/shared/.env に本番用の環境変数を設置する（.env.example参照）。
   ANTHROPIC_API_KEY, DATABASE_PATH 等。

2. ${APP_ROOT}/shared/caddy.env の BASIC_AUTH_PASSWORD_HASH を
   \`caddy hash-password\` の出力に書き換える。DOMAINも実際の値になっているか再確認する。

3. thinkingos ユーザーで一度だけリポジトリをclone:
     sudo -u thinkingos git clone https://github.com/OWNER/ThinkingOS.git ${APP_ROOT}/current

4. Caddy起動:
     sudo systemctl restart caddy
     sudo systemctl status caddy

5. GitHub側:
   - リポジトリの Secrets に VPS_HOST / VPS_USER(thinkingos) / VPS_SSH_KEY / (必要なら VPS_PORT) を設定する
   - infra/README.md を参照

6. 初回デプロイ後（.github/workflows/deploy.yml が走った後）:
     sudo systemctl start thinking-os
     sudo systemctl status thinking-os
     journalctl -u thinking-os -f

7. バックアップのcron設定は infra/backup/README相当（infra/README.md）を参照して
   thinkingosユーザーのcrontabに登録する。

EOF
