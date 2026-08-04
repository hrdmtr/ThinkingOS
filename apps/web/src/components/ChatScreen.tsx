import { useState } from "react";
import type { ChatMessage } from "../api.js";
import { streamChat } from "../api.js";

type Props = {
  sessionId: number;
  ending: boolean;
  onEndSession: (transcript: string) => void;
};

function formatTranscript(messages: ChatMessage[]): string {
  return messages
    .map((m) => `${m.role === "user" ? "ユーザー" : "AI"}: ${m.content}`)
    .join("\n\n");
}

export function ChatScreen({ sessionId, ending, onEndSession }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");
    setSending(true);

    // ストリーミングで届く断片を、その場でアシスタントの発言として組み立てていく。
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
    try {
      await streamChat(sessionId, nextMessages, (delta) => {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          updated[updated.length - 1] = { ...last, content: last.content + delta };
          return updated;
        });
      });
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `[エラー: ${(err as Error).message}]` },
      ]);
    } finally {
      setSending(false);
    }
  }

  function handleEnd() {
    onEndSession(formatTranscript(messages));
  }

  return (
    <div className="screen chat-screen">
      <h1>壁打ち</h1>
      <div className="chat-log">
        {messages.length === 0 && (
          <p className="hint">思っていることを、いつも通り話しかけてください。</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-message chat-message--${m.role}`}>
            <span className="chat-message__role">{m.role === "user" ? "あなた" : "AI"}</span>
            <p>{m.content}</p>
          </div>
        ))}
      </div>
      {ending && (
        <p className="ending-indicator" role="status">
          壁打ちを分析中...少し待ってください
        </p>
      )}
      <div className="chat-input-row">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder="ここに入力（Enterで送信、Shift+Enterで改行）"
          disabled={sending || ending}
        />
        <button onClick={() => void handleSend()} disabled={sending || ending || !input.trim()}>
          送信
        </button>
      </div>
      <button
        className="end-session-button"
        onClick={handleEnd}
        disabled={messages.length === 0 || sending || ending}
      >
        {ending ? "分析中..." : "壁打ちを終える"}
      </button>
    </div>
  );
}
