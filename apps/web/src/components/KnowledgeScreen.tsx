import { useCallback, useEffect, useState } from "react";
import type { Node, NodeType, SessionSummary, Stats, WeeklyStat } from "@thinking-os/shared";
import { NODE_TYPES } from "@thinking-os/shared";
import {
  editNode,
  fetchRecentNodes,
  fetchRecentSessions,
  fetchUnresolvedNodes,
  fetchWeeklyStats,
} from "../api.js";

type Props = {
  latestStats: Stats | null;
  latestSessionId: number | null;
  onStartSession: () => void;
  onContinueSession: (session: SessionSummary) => void;
};

const PREVIEW_LENGTH = 60;

function previewOf(transcript: string): string {
  const trimmed = transcript.trim();
  return trimmed.length > PREVIEW_LENGTH ? `${trimmed.slice(0, PREVIEW_LENGTH)}…` : trimmed;
}

type NodeItemProps = {
  node: Node;
  isNew: boolean;
  onSaved: () => void;
};

/**
 * 確定済みノード1件の表示・編集。ドッグフーディング初日に見つかった課題
 * （確定後に誤分類を直す手段がない）への対応。AIが再分類するのではなく、
 * 人間が自分の過去の確定判断を訂正する操作なので「AIは名付けをしない」原則には抵触しない。
 * 保存後はサーバーから最新の一覧を取り直す（ローカルでの手動マージはしない。
 * type変更で他の一覧への出入りが起きるため、その方が単純で確実）。
 *
 * isNewは「直前に確定した壁打ちセッションで生まれたノードか」を示す。一覧の中で
 * 今回見るべきものが分かりにくいというフィードバックへの対応（NEWマーク表示）。
 */
function NodeItem({ node, isNew, onSaved }: NodeItemProps) {
  const [editing, setEditing] = useState(false);
  const [type, setType] = useState<NodeType>(node.type);
  const [content, setContent] = useState(node.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <li>
        {isNew && <span className="new-badge">NEW</span>}
        <span className="node-type-badge">{node.type}</span> {node.content}{" "}
        <button className="edit-node-button" onClick={() => setEditing(true)}>
          編集
        </button>
      </li>
    );
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await editNode(node.id, type, content);
      setEditing(false);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setType(node.type);
    setContent(node.content);
    setError(null);
    setEditing(false);
  }

  return (
    <li className="node-item-editing">
      <select value={type} onChange={(e) => setType(e.target.value as NodeType)}>
        {NODE_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <textarea value={content} onChange={(e) => setContent(e.target.value)} />
      <div className="review-actions">
        <button onClick={() => void handleSave()} disabled={saving}>
          保存
        </button>
        <button onClick={handleCancel} disabled={saving}>
          キャンセル
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </li>
  );
}

/**
 * 起動時のホーム画面 (thinking-os-plan-v0.2.docx セクション6「表示」)。
 * 「今日の問い」はAIによる問いかけ生成が必要でまだ未実装（docs/step5-build-plan.mdでは
 * バッチ抽出と合わせて後続で実装する想定）。
 */
export function KnowledgeScreen({
  latestStats,
  latestSessionId,
  onStartSession,
  onContinueSession,
}: Props) {
  const [recentNodes, setRecentNodes] = useState<Node[]>([]);
  const [unresolvedNodes, setUnresolvedNodes] = useState<Node[]>([]);
  const [weeklyStats, setWeeklyStats] = useState<WeeklyStat[]>([]);
  const [recentSessions, setRecentSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const [recent, unresolved, weekly, sessions] = await Promise.all([
      fetchRecentNodes(),
      fetchUnresolvedNodes(),
      fetchWeeklyStats(),
      fetchRecentSessions(),
    ]);
    setRecentNodes(recent);
    setUnresolvedNodes(unresolved);
    setWeeklyStats(weekly);
    setRecentSessions(sessions);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, latestStats]);

  const ideaNodes = recentNodes.filter((n) => n.type === "アイデア");

  return (
    <div className="screen knowledge-screen">
      <h1>Thinking OS</h1>

      {latestStats && (
        <div className="stats-banner">
          <p>今回の壁打ちで生まれた命題：{latestStats.sessionPropositionCount}件</p>
          <p>
            これまでに整理した命題：{latestStats.cumulativePropositionCount}件、
            作成した関係：{latestStats.cumulativeRelationCount}件
          </p>
        </div>
      )}

      <button className="start-session-button" onClick={onStartSession}>
        壁打ちをはじめる
      </button>

      {loading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <section>
            <h2>前回までの壁打ちから続ける</h2>
            {recentSessions.length === 0 ? (
              <p className="hint">まだありません。</p>
            ) : (
              <ul className="session-list">
                {recentSessions.map((s) => (
                  <li key={s.id} className="session-list-item">
                    <span className="session-preview">{previewOf(s.transcript)}</span>
                    <button className="continue-session-button" onClick={() => onContinueSession(s)}>
                      続ける
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2>週次の命題数</h2>
            {weeklyStats.length === 0 ? (
              <p className="hint">まだありません。</p>
            ) : (
              <ul className="weekly-stats-list">
                {weeklyStats.map((w) => (
                  <li key={w.weekLabel}>
                    {w.weekStartDate}の週：{w.propositionCount}件
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2>未解決事項</h2>
            {unresolvedNodes.length === 0 ? (
              <p className="hint">まだありません。</p>
            ) : (
              <ul>
                {unresolvedNodes.map((n) => (
                  <NodeItem
                    key={n.id}
                    node={n}
                    isNew={n.sessionId === latestSessionId}
                    onSaved={() => void reload()}
                  />
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2>最近更新された知識</h2>
            {recentNodes.length === 0 ? (
              <p className="hint">まだ何も記録されていません。壁打ちをはじめてみましょう。</p>
            ) : (
              <ul>
                {recentNodes.map((n) => (
                  <NodeItem
                    key={n.id}
                    node={n}
                    isNew={n.sessionId === latestSessionId}
                    onSaved={() => void reload()}
                  />
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2>アイデア一覧</h2>
            {ideaNodes.length === 0 ? (
              <p className="hint">まだありません。</p>
            ) : (
              <ul>
                {ideaNodes.map((n) => (
                  <NodeItem
                    key={n.id}
                    node={n}
                    isNew={n.sessionId === latestSessionId}
                    onSaved={() => void reload()}
                  />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
