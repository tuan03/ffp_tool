import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

import { shopifyGatewayDevPlugin } from "./gateway/vite-plugin";

export default defineConfig({
  plugins: [react(), tailwindcss(), shopifyGatewayDevPlugin()],
  server: {
    proxy: {
      "^/api/(?!shopify)": {
        target: process.env.VITE_API_URL || "http://127.0.0.1:8765",
        changeOrigin: true,
      },
    },
  },
});
