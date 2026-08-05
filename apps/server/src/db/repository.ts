import type { Edge, Node, NodeType, SessionSummary, Stats, WeeklyStat } from "@thinking-os/shared";
import { INSIGHT_TAG, PROPOSITION_NODE_TYPES } from "@thinking-os/shared";
import { getDb } from "./index.js";

/**
 * tagsはnodes.tagsにカンマ区切り(前後にもカンマを付けた ",tag1,tag2," 形式)で保持する。
 * 前後のカンマにより、SQL側で `tags LIKE '%,' || ? || ',%'` という単純なLIKEで
 * 部分一致の誤検出(例: "気づき2"が"気づき"にマッチする等)を避けられる。
 */
function tagsToDb(tags: readonly string[]): string {
  return tags.length === 0 ? "" : `,${tags.join(",")},`;
}

function tagsFromDb(raw: string): string[] {
  return raw.split(",").filter((t) => t.length > 0);
}

export function createSession(continuedFromSessionId?: number): number {
  const result = getDb()
    .prepare("INSERT INTO sessions (started_at, continued_from_session_id) VALUES (?, ?)")
    .run(new Date().toISOString(), continuedFromSessionId ?? null);
  return Number(result.lastInsertRowid);
}

export function endSession(sessionId: number, transcript: string): void {
  getDb()
    .prepare("UPDATE sessions SET ended_at = ?, transcript = ? WHERE id = ?")
    .run(new Date().toISOString(), transcript, sessionId);
}

export function getTranscript(sessionId: number): string | undefined {
  const row = getDb()
    .prepare("SELECT transcript FROM sessions WHERE id = ?")
    .get(sessionId) as { transcript: string } | undefined;
  return row?.transcript;
}

/**
 * このセッションが継続元として指定した、過去のセッションのtranscriptを返す
 * （継続元を指定していなければundefined）。壁打ち中のAIチャットに文脈として渡す。
 */
export function getPreviousTranscript(sessionId: number): string | undefined {
  const row = getDb()
    .prepare(
      `SELECT s2.transcript AS transcript
       FROM sessions s1
       JOIN sessions s2 ON s2.id = s1.continued_from_session_id
       WHERE s1.id = ?`,
    )
    .get(sessionId) as { transcript: string } | undefined;
  return row?.transcript;
}

/**
 * 「前回の話題をもっと深掘りしたい」「後で新たな気づきがあった」ときに、
 * 過去のどのセッションからでも継続を選べるようにするための一覧
 * （ドッグフーディングでのフィードバックへの対応）。終了済みのセッションのみ対象。
 */
export function listRecentSessions(limit = 5): SessionSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT id, started_at, ended_at, transcript
       FROM sessions
       WHERE ended_at IS NOT NULL
       ORDER BY started_at DESC
       LIMIT ?`,
    )
    .all(limit) as { id: number; started_at: string; ended_at: string; transcript: string }[];

  return rows.map((r) => ({
    id: r.id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    transcript: r.transcript,
  }));
}

/**
 * ユーザーが統合レビュー画面で確定した場合のみ呼ばれる。
 * 未確定のAI提案はこの関数を通らず、DBには一切書き込まれない
 * (docs/step5-build-plan.md 2章・3章)。
 */
export function insertConfirmedNode(
  type: NodeType,
  content: string,
  sessionId: number,
  tags: readonly string[] = [],
): number {
  const result = getDb()
    .prepare(
      "INSERT INTO nodes (type, content, created_at, session_id, tags) VALUES (?, ?, ?, ?, ?)",
    )
    .run(type, content, new Date().toISOString(), sessionId, tagsToDb(tags));
  return Number(result.lastInsertRowid);
}

export function insertConfirmedEdge(
  sourceNodeId: number,
  targetNodeId: number,
  label: string,
  strength?: number | null,
): number {
  const result = getDb()
    .prepare(
      "INSERT INTO edges (source_node_id, target_node_id, label, strength, discovered_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(sourceNodeId, targetNodeId, label, strength ?? null, new Date().toISOString());
  return Number(result.lastInsertRowid);
}

function rowToNode(row: {
  id: number;
  type: string;
  content: string;
  created_at: string;
  session_id: number;
  tags: string;
}): Node {
  return {
    id: row.id,
    type: row.type as NodeType,
    content: row.content,
    createdAt: row.created_at,
    sessionId: row.session_id,
    tags: tagsFromDb(row.tags),
  };
}

export function getNodeById(id: number): Node | undefined {
  const row = getDb().prepare("SELECT * FROM nodes WHERE id = ?").get(id) as
    | Parameters<typeof rowToNode>[0]
    | undefined;
  return row ? rowToNode(row) : undefined;
}

/**
 * 確定済みノードの分類・内容を後から訂正する（ドッグフーディング初日に発見した課題への対応。
 * PDMレビュー：統計の遡及変化は「禁止」ではなく「変更の痕跡を残す」方針で扱う）。
 * AIが再分類するのではなく、あくまで人間が過去の自分の確定判断を訂正する操作であり、
 * 「AIは名付けをしない」原則には抵触しない。
 */
export function editNode(id: number, newType: NodeType, newContent: string): Node {
  const db = getDb();
  const applyEdit = db.transaction(() => {
    const current = getNodeById(id);
    if (!current) {
      throw new Error(`node ${id} not found`);
    }
    db.prepare(
      "INSERT INTO node_edits (node_id, from_type, to_type, from_content, to_content, edited_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(id, current.type, newType, current.content, newContent, new Date().toISOString());
    db.prepare("UPDATE nodes SET type = ?, content = ? WHERE id = ?").run(newType, newContent, id);
  });
  applyEdit();

  const updated = getNodeById(id);
  if (!updated) {
    throw new Error(`node ${id} not found after edit`);
  }
  return updated;
}

export function listRecentNodes(limit = 20): Node[] {
  const rows = getDb()
    .prepare("SELECT * FROM nodes ORDER BY created_at DESC LIMIT ?")
    .all(limit) as Parameters<typeof rowToNode>[0][];
  return rows.map(rowToNode);
}

export function listUnresolvedNodes(limit = 20): Node[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM nodes WHERE type = '未解決事項' ORDER BY created_at DESC LIMIT ?",
    )
    .all(limit) as Parameters<typeof rowToNode>[0][];
  return rows.map(rowToNode);
}

function rowToEdge(row: {
  id: number;
  source_node_id: number;
  target_node_id: number;
  label: string;
  strength: number | null;
  discovered_at: string;
}): Edge {
  return {
    id: row.id,
    sourceNodeId: row.source_node_id,
    targetNodeId: row.target_node_id,
    label: row.label,
    strength: row.strength,
    discoveredAt: row.discovered_at,
  };
}

export function listRecentEdges(limit = 20): Edge[] {
  const rows = getDb()
    .prepare("SELECT * FROM edges ORDER BY discovered_at DESC LIMIT ?")
    .all(limit) as Parameters<typeof rowToEdge>[0][];
  return rows.map(rowToEdge);
}

/**
 * セッション単位・累計の統計 (docs/step5-build-plan.md 5章)。
 * 「命題」はアイデア・仮説タイプのノードのみ (docs/step4-dogfooding.md)。
 * 他製品との相対比較はしない絶対統計であることに注意。
 * 気づき数はtypeとは無関係な集計で、あくまで参考情報(docs/step4-dogfooding.md、PDMレビュー済み)。
 */
export function getStats(sessionId: number): Stats {
  const propositionPlaceholders = PROPOSITION_NODE_TYPES.map(() => "?").join(", ");

  const sessionCount = getDb()
    .prepare(
      `SELECT COUNT(*) AS count FROM nodes WHERE session_id = ? AND type IN (${propositionPlaceholders})`,
    )
    .get(sessionId, ...PROPOSITION_NODE_TYPES) as { count: number };

  const cumulativeCount = getDb()
    .prepare(
      `SELECT COUNT(*) AS count FROM nodes WHERE type IN (${propositionPlaceholders})`,
    )
    .get(...PROPOSITION_NODE_TYPES) as { count: number };

  const relationCount = getDb()
    .prepare("SELECT COUNT(*) AS count FROM edges")
    .get() as { count: number };

  const insightTagPattern = `%,${INSIGHT_TAG},%`;

  const sessionInsightCount = getDb()
    .prepare("SELECT COUNT(*) AS count FROM nodes WHERE session_id = ? AND tags LIKE ?")
    .get(sessionId, insightTagPattern) as { count: number };

  const cumulativeInsightCount = getDb()
    .prepare("SELECT COUNT(*) AS count FROM nodes WHERE tags LIKE ?")
    .get(insightTagPattern) as { count: number };

  return {
    sessionPropositionCount: sessionCount.count,
    cumulativePropositionCount: cumulativeCount.count,
    cumulativeRelationCount: relationCount.count,
    sessionInsightCount: sessionInsightCount.count,
    cumulativeInsightCount: cumulativeInsightCount.count,
  };
}

/**
 * 週次の命題数集計 (docs/step4-dogfooding.md「週次の集計」)。
 * 撤退・継続基準（「命題数が2週連続で明確に減少している」等）の判断材料として使う。
 * 週の区切りはSQLiteのISO週番号（%Y-%W、月曜始まり）でグルーピングする。
 * 直近weeksBack件を古い週→新しい週の順で返す（推移が見やすいように）。
 */
export function getWeeklyStats(weeksBack = 6): WeeklyStat[] {
  const propositionPlaceholders = PROPOSITION_NODE_TYPES.map(() => "?").join(", ");
  const rows = getDb()
    .prepare(
      `SELECT strftime('%Y-%W', created_at) AS weekLabel,
              MIN(date(created_at)) AS weekStartDate,
              COUNT(*) AS count
       FROM nodes
       WHERE type IN (${propositionPlaceholders})
       GROUP BY weekLabel
       ORDER BY weekLabel DESC
       LIMIT ?`,
    )
    .all(...PROPOSITION_NODE_TYPES, weeksBack) as {
    weekLabel: string;
    weekStartDate: string;
    count: number;
  }[];

  return rows
    .map((r) => ({
      weekLabel: r.weekLabel,
      weekStartDate: r.weekStartDate,
      propositionCount: r.count,
    }))
    .reverse();
}
