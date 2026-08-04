import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 「今表示している画面がどのバージョンか分からない」というドッグフーディングでの
// フィードバックへの対応。ビルド時点のgit commit SHAを埋め込み、画面に常時表示する。
function getCommitHash(): string {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "unknown";
  }
}

// ローカル開発時のみ、フロントの開発サーバーからバックエンド(127.0.0.1:3000)へプロキシする。
// 本番はCaddyが単一オリジンとして両方を配信するため、このプロキシ設定は不要
// (docs/vps-architecture.md 3章)。
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_COMMIT__: JSON.stringify(getCommitHash()),
  },
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
    },
  },
});
