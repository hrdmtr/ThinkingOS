# infra/ - Thinking OS デプロイ・運用まわり

`docs/vps-architecture.md`（architect→security の2段階レビュー済み）の決定事項を実ファイル化したもの。
このディレクトリ配下と `.github/workflows/deploy.yml`、リポジトリルートの `.env.example` が対象。

秘密情報（実際のIP・ドメイン・パスワード・APIキー・鍵）はこのリポジトリのどこにも書かない。
すべてプレースホルダ、または VPS上の `/opt/thinking-os/shared/` 配下（git管理外）に置く。

## 構成一覧

| パス | 役割 |
|---|---|
| `infra/provisioning/setup.sh` | VPS初回セットアップ（root権限で1回実行） |
| `infra/systemd/thinking-os.service` | アプリ本体のsystemdユニット |
| `infra/Caddyfile` | リバースプロキシ・TLS・Basic認証・アクセスログ |
| `.github/workflows/deploy.yml` | `main`push契機の自動デプロイ |
| `infra/backup/backup.sh` | VPS側cron: SQLiteスナップショット＋暗号化＋ローテーション |
| `infra/backup/pull-backup.sh` | 手元PC側: 暗号化済みバックアップの取得 |
| `.env.example`（リポジトリルート） | 環境変数の雛形 |

## 1. 初回セットアップ手順（VPS）

1. Ubuntu 24.04 LTSのVPSを用意し、DNSの Aレコードを対象ドメインに向ける。
2. `infra/provisioning/setup.sh` を開き、冒頭の `CONFIG` セクションを編集する。
   - `ADMIN_SSH_PUBLIC_KEY`: 自分の実際の公開鍵に置き換える（**必須**。忘れるとSSHハードニング後にログインできなくなる）
   - `DOMAIN`: 実際のドメイン名
3. スクリプトをVPSに転送して実行する（root）。
   ```
   scp infra/provisioning/setup.sh root@<YOUR_VPS_IP>:/root/setup.sh
   ssh root@<YOUR_VPS_IP>
   chmod +x /root/setup.sh
   /root/setup.sh
   ```
   実行内容: apt更新、Node.js 22系（NodeSource）、Caddy、`thinkingos`ユーザー作成、
   `/opt/thinking-os/`配下のディレクトリ・権限設定、sudoers、ufw（22/80/443のみ）、
   fail2ban（sshd jail + Caddyの401検知jail）、SSHハードニング、systemdユニット・Caddyfileの設置。
4. スクリプト完了後、案内に従って手動で以下を行う。
   - `/opt/thinking-os/shared/.env` に本番用の環境変数を設置（`.env.example`参照。パーミッション600のまま）
   - `caddy hash-password` でBasic認証パスワードのハッシュを生成し、
     `/opt/thinking-os/shared/caddy.env` の `BASIC_AUTH_PASSWORD_HASH` に設定
   - `thinkingos`ユーザーでリポジトリを一度だけclone:
     ```
     sudo -u thinkingos git clone https://github.com/OWNER/ThinkingOS.git /opt/thinking-os/current
     ```
   - `sudo systemctl restart caddy` でCaddy起動（証明書取得が走る）
5. GitHub Secretsを設定（下記「GitHub Secrets」参照）。
6. `main`にpushすると`deploy.yml`が動き、初回デプロイとして
   `git pull` → `npm ci` → `npm run build --workspaces` → `systemctl restart thinking-os` が実行される。

## 2. デプロイの仕組み

`docs/vps-architecture.md` 5章の通り、Webhook等は使わずGitHub Actionsからのpush型SSHデプロイ。

- トリガー: `main`ブランチへのpush（マージ）
- 実行: `.github/workflows/deploy.yml` が `appleboy/ssh-action` でVPSにSSH接続し、
  `/opt/thinking-os/current` 上で `git pull` → `npm ci` → `npm run build --workspaces` →
  `sudo systemctl restart thinking-os`
- ロールバック: releases/symlinkスワップ方式は採用していない。問題が起きたら
  VPS上で `git reset --hard <直前のコミット>` し、`sudo systemctl restart thinking-os` で戻す。
- `thinking-os.service` の `ExecStart` はモノレポの実ワークスペース構成が固まる前の仮置き
  （`npm run start --workspace=apps/server` を想定）。実装が固まったら実体に合わせて修正すること。

## 3. バックアップの運用

`docs/vps-architecture.md` 7章の通り、宛先はユーザー自身のPC（追加の外部サービス費用なし）。
VPS→PCへの送信ではなく、PC側からVPSへ**取りに行く（プル型）**構成。

1. **鍵の準備（初回のみ、手元PCで）**
   ```
   age-keygen -o thinking-os-backup-key.txt
   ```
   出力される `public key: age1...` を `THINKING_OS_BACKUP_AGE_RECIPIENT` として
   VPS側の `/opt/thinking-os/shared/.env` に設定する。秘密鍵ファイル（`thinking-os-backup-key.txt`）は
   **VPSには置かず**手元PCでのみ保管する。

2. **VPS側: cronでスナップショット作成**（`thinkingos`ユーザーの`crontab -e`）
   ```
   0 3 * * * /opt/thinking-os/current/infra/backup/backup.sh >> /opt/thinking-os/shared/backups/backup.log 2>&1
   ```
   毎日3時に `sqlite3 .backup` でスナップショット→`age`で暗号化→
   直近7世代のみ保持（`infra/backup/backup.sh`内の`THINKING_OS_BACKUP_RETENTION`で変更可）。
   出力先: `/opt/thinking-os/shared/backups/thinkingos_YYYYMMDD_HHMMSS.sqlite.age`

3. **手元PC側: 定期的に取得**
   ```
   THINKING_OS_VPS_HOST=<YOUR_VPS_IP_OR_HOSTNAME> \
   infra/backup/pull-backup.sh
   ```
   rsync（優先）またはscpで、VPS上の暗号化済みファイルを`~/thinking-os-backups/`へ取得する。
   常時起動しているマシンがあればcron等で定期実行、なければ思い出したときの手動実行でもよい
   （VPS側に直近7世代残るため多少間隔が空いても取りこぼしにくい）。

4. **復号（必要になったときだけ）**
   ```
   age -d -i thinking-os-backup-key.txt -o restored.sqlite thinkingos_20260101_030000.sqlite.age
   ```

## 4. GitHub Secretsに設定すべき値

リポジトリの `Settings > Secrets and variables > Actions` に以下を登録する。

| Secret名 | 内容 |
|---|---|
| `VPS_HOST` | デプロイ先VPSのホスト名 or IPアドレス |
| `VPS_USER` | SSH接続ユーザー名（`thinkingos`） |
| `VPS_SSH_KEY` | 上記ユーザーで接続するための**秘密鍵**（PEM形式）。対応する公開鍵は事前にVPS側`~thinkingos/.ssh/authorized_keys`へ登録しておく（`setup.sh`のADMIN_SSH_PUBLIC_KEY、または別途追加） |
| `VPS_PORT`（任意） | SSHポート番号。未設定なら22を使用 |

いずれもリポジトリ本体にはコミットしない。鍵はデプロイ専用に新規生成し、
万一漏洩した場合に備えてVPS側の`authorized_keys`からいつでも失効できるようにしておくことを推奨する。

## 5. 既知のトレードオフ（再掲）

デプロイ用ユーザーとアプリ実行ユーザーが同一（`thinkingos`）のため、`VPS_SSH_KEY`漏洩は
`.env`・SQLite DBの読み取りを含むフル侵害につながる（`docs/vps-architecture.md` 4章で
単一ユーザー運用の簡略化として許容済み）。GitHubアカウントの2FA必須化・`main`への直接push制限で緩和する。
