import { useEffect, useState } from "react";
import type { Node, Stats } from "@thinking-os/shared";
import { fetchRecentNodes, fetchUnresolvedNodes } from "../api.js";

type Props = {
  latestStats: Stats | null;
  onStartSession: () => void;
};

/**
 * 起動時のホーム画面 (thinking-os-plan-v0.2.docx セクション6「表示」)。
 * 「今日の問い」はAIによる問いかけ生成が必要でまだ未実装（docs/step5-build-plan.mdでは
 * バッチ抽出と合わせて後続で実装する想定）。ここでは確定済みデータの表示のみ。
 */
export function KnowledgeScreen({ latestStats, onStartSession }: Props) {
  const [recentNodes, setRecentNodes] = useState<Node[]>([]);
  const [unresolvedNodes, setUnresolvedNodes] = useState<Node[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const [recent, unresolved] = await Promise.all([
        fetchRecentNodes(),
        fetchUnresolvedNodes(),
      ]);
      setRecentNodes(recent);
      setUnresolvedNodes(unresolved);
      setLoading(false);
    })();
  }, [latestStats]);

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
            <h2>未解決事項</h2>
            {unresolvedNodes.length === 0 ? (
              <p className="hint">まだありません。</p>
            ) : (
              <ul>
                {unresolvedNodes.map((n) => (
                  <li key={n.id}>{n.content}</li>
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
                  <li key={n.id}>
                    <span className="node-type-badge">{n.type}</span> {n.content}
                  </li>
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
                  <li key={n.id}>{n.content}</li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
