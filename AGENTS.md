# AGENTS.md

実装作業で得た教訓の蓄積。節目でのポストモーテット（`CLAUDE.md`参照）をもとに追記していく。
経過報告や一時的な状況は書かず、「次に同じ状況に遭遇したときにすぐ対処できる」具体的な教訓のみを残す。

---

## ローカル開発環境（Windows）とネイティブNodeモジュール

**問題**：`better-sqlite3`のような、コンパイルが必要なネイティブNodeモジュールをこのリポジトリのローカル開発機（Windows, Node v26）でインストールしようとすると、以下の順で失敗する。

1. `better-sqlite3`の事前ビルド済みバイナリが、新しすぎるNodeバージョン（v26）向けには存在せず、ソースからのビルドにフォールバックする。
2. ソースビルドには Python 3.6+ が必要（このマシンには有効なPythonが入っていなかった）。
3. Pythonを入れても、Windowsでのネイティブビルドには Visual Studio Build Tools（C++ワークロード）が必要（数GB・長時間のインストールになる重い依存）。

**教訓・対処法**：
- 本番デプロイ先はUbuntu 24.04 + Node.js 22系（`docs/vps-architecture.md`）であり、そちらでは`better-sqlite3`の事前ビルド済みバイナリが問題なく取得できる想定。ローカルのWindows開発機でVisual Studio Build Toolsをフルインストールする必要はない。
- ローカルでは `npm install --ignore-scripts` を使い、ネイティブビルドをスキップする。TypeScriptの型チェック（`tsc --noEmit`）は型定義（`@types/better-sqlite3`）だけで完結するため、コンパイル済みバイナイルがなくても問題なく通る。
- 実際にSQLiteを使ったランタイム動作確認（DBへの読み書きなど）は、ローカルでは行わず、VPS上（実際のNode 22環境）で確認する。
- Pythonが必要になった場合、`winget install --id Python.Python.3.12 -e --silent --accept-package-agreements --accept-source-agreements` で素早く導入できる（このマシンでは動作確認済み）。ただしbetter-sqlite3の件ではPythonだけでは解決しなかった（Visual Studio Build Toolsも必要）ため、上記の「そもそもローカルでネイティブビルドしない」方針を優先すること。
