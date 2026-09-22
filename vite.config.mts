import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

import { shopifyGatewayDevPlugin } from "./gateway/vite-plugin";

export default defineConfig({
  plugins: [react(), tailwindcss(), shopifyGatewayDevPlugin()],
});
