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
- **注意**：`--ignore-scripts`は`postinstall`も無効化する。ルートの`postinstall`は`@thinking-os/shared`を自動ビルドする役目を持つため、`--ignore-scripts`でインストールした後は`npm run build --workspace=@thinking-os/shared`を手動で実行しておくこと。忘れると、他ワークスペースの型チェックで「`@thinking-os/shared`の宣言ファイルが見つからない」エラーになる。

## npm workspacesパッケージは実行時解決までtsconfigの`paths`だけに頼らない

**問題**：ワークスペース内の共有パッケージ（例：`packages/shared`）をアプリから使う際、`package.json`の`main`/`types`をコンパイルされていないソースの`.ts`に直接向け、tsconfigの`paths`エイリアスで型解決だけ帳尻を合わせる、という構成にすると、`tsx`や`Vite`のようにその場でTypeScriptを解釈するツールでは問題が起きないため気づきにくいが、本番で使う素の`node dist/index.js`実行では`ERR_MODULE_NOT_FOUND`で確実に落ちる（Node自身はTypeScriptを実行できないため）。

さらに、`tsconfig`の`extends`で継承した親設定（例：リポジトリ直下の`tsconfig.base.json`）に書いた`paths`の相対パスは、**それを継承する側のディレクトリではなく、`paths`を定義した親設定ファイル自身の場所を基準に解決される**。子パッケージ側のディレクトリ階層を基準に相対パスを書くと、静かに誤った場所を指し、意図したパスマッピングが機能しないままフォールバック解決（＝上記の壊れた`main`）に流れてしまう。

**教訓・対処法**：
- ワークスペース内で共有する型・値を持つパッケージには、必ず実際の`tsc`ビルドステップ（`dist/*.js` + `declaration: true`で`dist/*.d.ts`）を持たせ、`package.json`の`main`/`types`はビルド成果物（`dist/`）を指すこと。ソース`.ts`を直接指すのはNG。
- 複数ワークスペースが依存する共有パッケージは、ルートの`package.json`に`postinstall`スクリプトを置き、`npm ci`/`npm install`のたびに確実にビルドされるようにしておくと、ワークスペースのビルド順序に依存せずに済む。
- `tsconfig`の`paths`を使う場合、それが「型チェック時の型解決のためだけの便宜」なのか「実行時の解決も肩代わりするつもり」なのかを明確に意識する。後者を期待するなら`paths`では実現できない（実行時にtsconfigは読まれない）。
- `paths`の相対パスは、それを定義したファイル（`extends`元も含む）の場所を基準に解決される。共通の`tsconfig.base.json`に`paths`を書く場合は、そのファイル自身の場所からの相対パスで書くこと。
