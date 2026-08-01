# Thinking OS（仮称）VPSアーキテクチャ・確定事項

> `docs/step5-build-plan.md`の続き。ホスティングをRailway（PaaS）からVPS1台に変更したことに伴う技術詳細。architect→security の2段階レビューを経て確定。

---

## 前提（変更なし）

- フロントエンド：React 18 + TypeScript + Vite。グラフ可視化ライブラリ（Cytoscape.js等）は導入しない（MVP要件はカード/リストUIのみ。将来機能）。
- バックエンド：Node.js + TypeScript + Fastify + better-sqlite3。ORMは導入しない（生SQL＋zodでスキーマ検証）。
- データ：SQLite単一ファイル。`nodes`/`edges`テーブル、未確定候補は永続化しない。
- リポジトリ：モノレポ（npm workspaces）。ビルド順序オーケストレーションは組まず、tsconfigの`paths`エイリアスで型共有。
- ブランチ戦略：GitHub Flow。

## 1. OS・ランタイム

- **OS**：Ubuntu 24.04 LTS
- **Node.js**：**22系（Active LTS）**をNodeSource公式APTリポジトリからインストール。
  - 当初20系で検討したが、20系は2026-04-30にEOL済みと判明したため22系に変更（security指摘）。
  - nvmは使わない（systemdサービスから使う際にPATH解決が壊れやすいため）。OSパッケージとして単一バージョンを固定。
  - 運用ルール：メジャーバージョンのEOLを年1回程度で確認し、計画的にバンプする。

## 2. プロセス管理

- **systemd**採用（pm2は導入しない。追加の常駐プロセスを増やさない）。
- `Restart=on-failure`で自動復帰、ログは`journalctl`に集約。

## 3. リバースプロキシ・TLS

- **Caddy**採用（Nginx+certbotより設定・証明書更新の運用負荷が低い）。
- Let's Encryptで自動取得・自動更新。
- アクセスログをファイル出力し、fail2banの検知対象にする（4章参照）。

## 4. セキュリティ（VPS公開に伴う必須対策）

Basic認証は総当たり攻撃への耐性を単体では持たないため、以下を**必須**とする。

- **ufw**：22(SSH)/80/443のみ開放。SSHは可能なら発信元IPを絞る。
- **fail2ban**：Caddyのアクセスログから401（認証失敗）の連続発生を検知してBAN（maxretry=5, findtime=600, bantime=3600）。sshdのjailも有効化。
- **SSHハードニング**：`PasswordAuthentication no`、`PermitRootLogin no`（GitHub Actionsからのデプロイも鍵認証前提のため支障なし）。
- **sudoers**：デプロイ用ユーザーに許可するコマンドはフルパス完全一致で固定（ワイルドカード不可）。
  ```
  thinkingos ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart thinking-os
  ```
- **既知のトレードオフとして許容**：デプロイ用ユーザーとアプリ実行ユーザーが同一（`thinkingos`）のため、デプロイ鍵漏洩は`.env`・SQLite DBの読み取りを含むフル侵害につながる。単一ユーザー運用での簡略化として許容するが、GitHubアカウント側の2FA必須化・mainへの直接push制限で緩和する。

## 5. デプロイ方式

GitHub Actionsから`appleboy/ssh-action`でVPSへSSH接続し、`main`マージをトリガーに以下を実行：
`git pull` → `npm ci` → `npm run build --workspaces` → `sudo systemctl restart thinking-os`

Webhook＋VPS側pullスクリプト方式は不採用（公開エンドポイントが増えるため）。

## 6. ディレクトリ構成・権限

- 専用の非rootユーザー`thinkingos`を作成（`useradd -r -m -s /bin/bash thinkingos`）。
- 配置パス：`/opt/thinking-os/`
  - `current/` … アプリ本体（git pull対象）
  - `shared/.env` … 環境変数（gitに含めない、パーミッション600）
  - `shared/data/thinkingos.sqlite` … SQLiteファイル本体（gitに含めない、パーミッション600）
- releases/symlinkスワップ方式は採用せず、単一ディレクトリへの上書き＋`systemctl restart`。ロールバックは`git reset --hard`で対応。

## 7. バックアップ

- **宛先：ユーザー自身のPC**（追加の外部サービス・費用なし）。
- VPS側でcronにより`sqlite3 .backup`でスナップショットを作成し、`age`等で暗号化。
- ユーザーのPCから定期的にscp/rsyncで引き取る（プル型。VPS側から外部へ送信する経路を増やさない）。
- 実装（暗号化コマンド・cron設定・pullスクリプトの叩き台）はinfra担当が用意する。

## 8. Anthropic APIへのデータ送信

- 会話ログ・ノード/エッジ抽出のための送信はアプリの本質的機能であり、新たな脆弱性ではない（security確認済み・問題なし）。
- SDK経由の通信は標準でHTTPS。APIキーは`.env`経由のみで、リポジトリ・ログに出力しない。

---

## 未実装（infra担当への引き継ぎ）
- [ ] systemdユニットファイル
- [ ] Caddyfile
- [ ] ufw / fail2ban設定
- [ ] SSHハードニング設定
- [ ] GitHub Actionsデプロイワークフロー
- [ ] バックアップスクリプト（VPS側cron＋暗号化）＋ローカルPC側の取得手順
- [ ] `.env.example`
