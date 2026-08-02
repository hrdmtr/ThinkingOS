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
    try {
      const extraction = await endSession(sessionId, transcript);
      setScreen({ name: "review", extraction });
    } catch (err) {
      setError((err as Error).message);
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
          onEndSession={(transcript) => void handleEndSession(screen.sessionId, transcript)}
        />
      )}
      {screen.name === "review" && (
        <ReviewScreen
          extraction={screen.extraction}
          onDone={() => void handleReviewDone(screen.extraction.sessionId)}
        />
      )}
    </div>
  );
}
