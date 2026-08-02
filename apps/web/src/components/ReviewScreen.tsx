import { useState } from "react";
import type {
  EdgeCandidate,
  EdgeReview,
  ExtractionResult,
  NodeCandidate,
  NodeReview,
  NodeType,
} from "@thinking-os/shared";
import { NODE_TYPES } from "@thinking-os/shared";
import { submitReview } from "../api.js";

type Props = {
  extraction: ExtractionResult;
  onDone: () => void;
};

type NodeDecisionState = {
  decision: "confirm" | "edit" | "reject";
  type: NodeType;
  content: string;
};

type EdgeDecisionState = {
  decision: "confirm" | "edit" | "reject";
  label: string;
};

/**
 * セッション終了直後の統合レビュー画面 (docs/step5-build-plan.md 3章)。
 * ノードとエッジをtype別にグループ化して一覧表示し、確定/修正/却下をユーザーが行う。
 * AIの提案はここでユーザーが確定するまで一切DBに保存されない。
 */
export function ReviewScreen({ extraction, onDone }: Props) {
  const [nodeStates, setNodeStates] = useState<Record<string, NodeDecisionState>>(() =>
    Object.fromEntries(
      extraction.newNodes.map((n) => [
        n.tempId,
        { decision: "confirm" as const, type: n.type, content: n.content },
      ]),
    ),
  );
  const [edgeStates, setEdgeStates] = useState<Record<string, EdgeDecisionState>>(() =>
    Object.fromEntries(
      extraction.edgeCandidates.map((e) => [
        e.tempId,
        { decision: "confirm" as const, label: e.labelSuggestion },
      ]),
    ),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nodesByType = new Map<NodeType, NodeCandidate[]>();
  for (const type of NODE_TYPES) nodesByType.set(type, []);
  for (const node of extraction.newNodes) {
    nodesByType.get(node.type)?.push(node);
  }

  function updateNode(tempId: string, patch: Partial<NodeDecisionState>) {
    setNodeStates((prev) => ({ ...prev, [tempId]: { ...prev[tempId], ...patch } }));
  }

  function updateEdge(tempId: string, patch: Partial<EdgeDecisionState>) {
    setEdgeStates((prev) => ({ ...prev, [tempId]: { ...prev[tempId], ...patch } }));
  }

  function acceptAll() {
    setNodeStates((prev) =>
      Object.fromEntries(Object.entries(prev).map(([id, s]) => [id, { ...s, decision: "confirm" }])),
    );
    setEdgeStates((prev) =>
      Object.fromEntries(Object.entries(prev).map(([id, s]) => [id, { ...s, decision: "confirm" }])),
    );
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const nodeReviews: NodeReview[] = extraction.newNodes.map((n) => {
        const state = nodeStates[n.tempId];
        return {
          tempId: n.tempId,
          decision: state.decision,
          type: state.decision === "reject" ? undefined : state.type,
          content: state.decision === "reject" ? undefined : state.content,
        };
      });

      const edgeReviews: EdgeReview[] = extraction.edgeCandidates.map((e) => {
        const state = edgeStates[e.tempId];
        return {
          tempId: e.tempId,
          decision: state.decision,
          sourceRef: state.decision === "reject" ? undefined : e.sourceRef,
          targetRef: state.decision === "reject" ? undefined : e.targetRef,
          label: state.decision === "reject" ? undefined : state.label,
        };
      });

      await submitReview({ sessionId: extraction.sessionId, nodeReviews, edgeReviews });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const nodeLabel = (ref: string | number, nodes: NodeCandidate[]) => {
    if (typeof ref === "number") return `既存ノード #${ref}`;
    const found = nodes.find((n) => n.tempId === ref);
    return found ? found.content : ref;
  };

  return (
    <div className="screen review-screen">
      <h1>今回の壁打ちで見つかったもの</h1>
      <p className="hint">
        AIの提案です。内容を確認して、確定・修正・却下を選んでください。却下したものは保存されません。
      </p>
      <button onClick={acceptAll} className="accept-all-button">
        すべて確定でOK
      </button>

      {NODE_TYPES.map((type) => {
        const nodes = nodesByType.get(type) ?? [];
        if (nodes.length === 0) return null;
        return (
          <section key={type} className="review-group">
            <h2>
              {type}（{nodes.length}件）
            </h2>
            {nodes.map((n) => {
              const state = nodeStates[n.tempId];
              return (
                <div key={n.tempId} className={`review-item review-item--${state.decision}`}>
                  {state.decision === "edit" ? (
                    <textarea
                      value={state.content}
                      onChange={(e) => updateNode(n.tempId, { content: e.target.value })}
                    />
                  ) : (
                    <p>{state.content}</p>
                  )}
                  <div className="review-actions">
                    <button
                      className={state.decision === "confirm" ? "active" : ""}
                      onClick={() => updateNode(n.tempId, { decision: "confirm", content: n.content })}
                    >
                      確定
                    </button>
                    <button
                      className={state.decision === "edit" ? "active" : ""}
                      onClick={() => updateNode(n.tempId, { decision: "edit" })}
                    >
                      修正
                    </button>
                    <button
                      className={state.decision === "reject" ? "active" : ""}
                      onClick={() => updateNode(n.tempId, { decision: "reject" })}
                    >
                      却下
                    </button>
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}

      {extraction.edgeCandidates.length > 0 && (
        <section className="review-group">
          <h2>関係候補（{extraction.edgeCandidates.length}件）</h2>
          {extraction.edgeCandidates.map((e: EdgeCandidate) => {
            const state = edgeStates[e.tempId];
            return (
              <div key={e.tempId} className={`review-item review-item--${state.decision}`}>
                <p className="edge-endpoints">
                  {nodeLabel(e.sourceRef, extraction.newNodes)} → {nodeLabel(e.targetRef, extraction.newNodes)}
                </p>
                {state.decision === "edit" ? (
                  <input
                    value={state.label}
                    onChange={(ev) => updateEdge(e.tempId, { label: ev.target.value })}
                  />
                ) : (
                  <p className="edge-label">ラベル: {state.label}</p>
                )}
                {e.rationale && <p className="edge-rationale">理由: {e.rationale}</p>}
                <div className="review-actions">
                  <button
                    className={state.decision === "confirm" ? "active" : ""}
                    onClick={() => updateEdge(e.tempId, { decision: "confirm", label: e.labelSuggestion })}
                  >
                    確定
                  </button>
                  <button
                    className={state.decision === "edit" ? "active" : ""}
                    onClick={() => updateEdge(e.tempId, { decision: "edit" })}
                  >
                    修正
                  </button>
                  <button
                    className={state.decision === "reject" ? "active" : ""}
                    onClick={() => updateEdge(e.tempId, { decision: "reject" })}
                  >
                    却下
                  </button>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {error && <p className="error">{error}</p>}
      <button className="submit-button" onClick={() => void handleSubmit()} disabled={submitting}>
        この内容で確定する
      </button>
    </div>
  );
}
