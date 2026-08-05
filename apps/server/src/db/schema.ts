/**
 * DBスキーマ。docs/step5-build-plan.md 2章のnodes/edgesテーブル定義をそのまま反映。
 *
 * sessionsテーブルはdocs内では明示されていないが、nodes.session_idの参照先として
 * 最低限必要なため追加した（1セッション＝1回の壁打ち。transcriptはバッチ抽出の入力に使う
 * 会話ログ全文で、抽出後も「聞き返し」機能の参照元として保持する）。
 */
export const SCHEMA_SQL = `
-- continued_from_session_idは「前回のセッションの話題を続けたい」という
-- ドッグフーディングでのフィードバックへの対応。過去のどのセッションからでも
-- 継続でき、継続元のtranscriptをAIチャットの文脈として渡すために使う。
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  transcript TEXT NOT NULL DEFAULT '',
  continued_from_session_id INTEGER REFERENCES sessions(id)
);

-- typeの許容値はCHECK制約ではなくアプリ層のzod (NodeTypeSchema) だけで検証する。
-- CHECK制約にすると、ノード分類の語彙を変更するたびにSQLiteのテーブル再作成が
-- 必要になり移行コストが高い（実際に「根拠」→「事実」への変更で発生した問題）。
CREATE TABLE IF NOT EXISTS nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  session_id INTEGER NOT NULL REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_node_id INTEGER NOT NULL REFERENCES nodes(id),
  target_node_id INTEGER NOT NULL REFERENCES nodes(id),
  label TEXT NOT NULL,
  strength REAL,
  discovered_at TEXT NOT NULL
);

-- 確定済みノードを後から編集した際の軽量な変更ログ（PDMレビュー: 統計の遡及変化を
-- 「禁止」ではなく「痕跡を残す」ことで扱う方針）。閲覧UIはMVP対象外、DBに残すのみ。
CREATE TABLE IF NOT EXISTS node_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id INTEGER NOT NULL REFERENCES nodes(id),
  from_type TEXT NOT NULL,
  to_type TEXT NOT NULL,
  from_content TEXT NOT NULL,
  to_content TEXT NOT NULL,
  edited_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nodes_session_id ON nodes(session_id);
CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_node_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_node_id);
CREATE INDEX IF NOT EXISTS idx_node_edits_node_id ON node_edits(node_id);
`;
