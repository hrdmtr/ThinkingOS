import type { Edge, Node, NodeType, Stats } from "@thinking-os/shared";
import { PROPOSITION_NODE_TYPES } from "@thinking-os/shared";
import { getDb } from "./index.js";

export function createSession(): number {
  const result = getDb()
    .prepare("INSERT INTO sessions (started_at) VALUES (?)")
    .run(new Date().toISOString());
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
 * ユーザーが統合レビュー画面で確定した場合のみ呼ばれる。
 * 未確定のAI提案はこの関数を通らず、DBには一切書き込まれない
 * (docs/step5-build-plan.md 2章・3章)。
 */
export function insertConfirmedNode(
  type: NodeType,
  content: string,
  sessionId: number,
): number {
  const result = getDb()
    .prepare(
      "INSERT INTO nodes (type, content, created_at, session_id) VALUES (?, ?, ?, ?)",
    )
    .run(type, content, new Date().toISOString(), sessionId);
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
}): Node {
  return {
    id: row.id,
    type: row.type as NodeType,
    content: row.content,
    createdAt: row.created_at,
    sessionId: row.session_id,
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

  return {
    sessionPropositionCount: sessionCount.count,
    cumulativePropositionCount: cumulativeCount.count,
    cumulativeRelationCount: relationCount.count,
  };
}
