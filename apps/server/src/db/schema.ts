/**
 * DBスキーマ。docs/step5-build-plan.md 2章のnodes/edgesテーブル定義をそのまま反映。
 *
 * sessionsテーブルはdocs内では明示されていないが、nodes.session_idの参照先として
 * 最低限必要なため追加した（1セッション＝1回の壁打ち。transcriptはバッチ抽出の入力に使う
 * 会話ログ全文で、抽出後も「聞き返し」機能の参照元として保持する）。
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  transcript TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('アイデア','仮説','根拠','判断','未解決事項','タスク')),
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

CREATE INDEX IF NOT EXISTS idx_nodes_session_id ON nodes(session_id);
CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_node_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_node_id);
`;
