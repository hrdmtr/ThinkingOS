import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// ローカル開発時のみ、フロントの開発サーバーからバックエンド(127.0.0.1:3000)へプロキシする。
// 本番はCaddyが単一オリジンとして両方を配信するため、このプロキシ設定は不要
// (docs/vps-architecture.md 3章)。
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
    },
  },
});
