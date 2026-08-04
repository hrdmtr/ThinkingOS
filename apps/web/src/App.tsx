import { useState } from "react";
import type { ExtractionResult, Stats } from "@thinking-os/shared";
import { createSession, endSession, fetchStats } from "./api.js";
import { ChatScreen } from "./components/ChatScreen.js";
import { KnowledgeScreen } from "./components/KnowledgeScreen.js";
import { ReviewScreen } from "./components/ReviewScreen.js";

type Screen =
  | { name: "knowledge" }
  | { name: "chat"; sessionId: number }
  | { name: "review"; extraction: ExtractionResult };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: "knowledge" });
  const [latestStats, setLatestStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 「壁打ちを終える」から抽出結果が返るまでの間、無反応に見えて不安になるという
  // ドッグフーディングでのフィードバックへの対応。ChatScreenの会話状態は保ったまま
  // (画面遷移させない)、ローディング表示だけ出す。
  const [ending, setEnding] = useState(false);

  async function handleStartSession() {
    setError(null);
    try {
      const { sessionId } = await createSession();
      setScreen({ name: "chat", sessionId });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleEndSession(sessionId: number, transcript: string) {
    setError(null);
    setEnding(true);
    try {
      const extraction = await endSession(sessionId, transcript);
      setScreen({ name: "review", extraction });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnding(false);
    }
  }

  async function handleReviewDone(sessionId: number) {
    const stats = await fetchStats(sessionId);
    setLatestStats(stats);
    setScreen({ name: "knowledge" });
  }

  return (
    <div className="app">
      {error && <p className="error">{error}</p>}
      {screen.name === "knowledge" && (
        <KnowledgeScreen latestStats={latestStats} onStartSession={() => void handleStartSession()} />
      )}
      {screen.name === "chat" && (
        <ChatScreen
          sessionId={screen.sessionId}
          ending={ending}
          onEndSession={(transcript) => void handleEndSession(screen.sessionId, transcript)}
        />
      )}
      {screen.name === "review" && (
        <ReviewScreen
          extraction={screen.extraction}
          onDone={() => void handleReviewDone(screen.extraction.sessionId)}
        />
      )}
      <p className="version-footer">v{__APP_COMMIT__}</p>
    </div>
  );
}
