import type {
  Edge,
  ExtractionResult,
  Node,
  NodeType,
  Stats,
  SubmitReviewRequest,
  WeeklyStat,
} from "@thinking-os/shared";

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error ${response.status}: ${body}`);
  }
  return response.json() as Promise<T>;
}

export async function createSession(): Promise<{ sessionId: number }> {
  const res = await fetch("/api/sessions", { method: "POST" });
  return json(res);
}

export type ChatMessage = { role: "user" | "assistant"; content: string };

/** ストリーミングチャット。onDeltaがテキスト断片ごとに呼ばれる。 */
export async function streamChat(
  sessionId: number,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
): Promise<void> {
  const res = await fetch(`/api/sessions/${sessionId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`chat API error ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onDelta(decoder.decode(value, { stream: true }));
  }
}

export async function endSession(
  sessionId: number,
  transcript: string,
): Promise<ExtractionResult> {
  const res = await fetch(`/api/sessions/${sessionId}/end`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript }),
  });
  return json(res);
}

export async function submitReview(
  request: SubmitReviewRequest,
): Promise<{ confirmedNodeIds: Record<string, number>; confirmedEdgeIds: Record<string, number> }> {
  const res = await fetch(`/api/sessions/${request.sessionId}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  return json(res);
}

export async function fetchStats(sessionId: number): Promise<Stats> {
  const res = await fetch(`/api/stats?sessionId=${sessionId}`);
  return json(res);
}

export async function fetchWeeklyStats(): Promise<WeeklyStat[]> {
  const res = await fetch("/api/stats/weekly");
  return json(res);
}

export async function fetchRecentNodes(): Promise<Node[]> {
  const res = await fetch("/api/nodes/recent");
  return json(res);
}

export async function fetchUnresolvedNodes(): Promise<Node[]> {
  const res = await fetch("/api/nodes/unresolved");
  return json(res);
}

/** 確定済みノードの分類・内容を後から訂正する。 */
export async function editNode(id: number, type: NodeType, content: string): Promise<Node> {
  const res = await fetch(`/api/nodes/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, content }),
  });
  return json(res);
}

export type { Edge, Node, Stats };
