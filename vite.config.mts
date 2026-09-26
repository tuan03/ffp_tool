import net from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";
import { shopifyGatewayDevPlugin } from "./gateway/vite-plugin";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function isPortListening(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(400);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

function pinterestPodBackendPlugin(): Plugin {
  let pyProcess: ChildProcess | null = null;

  return {
    name: "vite-plugin-pinterest-pod-backend",
    apply: "serve", // Only runs during 'npm run dev', not during build
    async configureServer(server) {
      if (server.config.mode === "mock") {
        return;
      }

      const port = 8768;
      const isRunning = await isPortListening(port);
      if (isRunning) {
        console.log(`\x1b[36m[pinterest-pod]\x1b[0m Python backend is already running on port ${port}.`);
        return;
      }

      const serverScript = path.resolve(__dirname, "src/modules/pinterest-pod/server/server.py");
      console.log(`\x1b[36m[pinterest-pod]\x1b[0m Auto-starting Python backend on port ${port}...`);

      try {
        pyProcess = spawn("python", [serverScript], {
          stdio: "inherit",
          detached: false,
        });

        pyProcess.on("error", (err) => {
          console.warn(`\x1b[33m[pinterest-pod] Auto-start backend warning:\x1b[0m ${err.message}`);
        });

        const cleanup = () => {
          if (pyProcess && !pyProcess.killed) {
            try {
              if (process.platform === "win32" && pyProcess.pid) {
                spawn("taskkill", ["/pid", pyProcess.pid.toString(), "/f", "/t"]);
              } else {
                pyProcess.kill();
              }
            } catch {
              // Ignore cleanup error
            }
          }
        };

        server.httpServer?.on("close", cleanup);
        process.on("exit", cleanup);
        process.on("SIGINT", cleanup);
        process.on("SIGTERM", cleanup);
      } catch (err: unknown) {
        console.warn(`\x1b[33m[pinterest-pod] Could not spawn python process:\x1b[0m`, err);
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), pinterestPodBackendPlugin(), shopifyGatewayDevPlugin()],
  server: {
    proxy: {
      "/api/pinterest-pod": {
        target: process.env.VITE_PINTEREST_POD_API_URL || "http://127.0.0.1:8768",
        changeOrigin: true,
      },
      "^/api/(?!shopify)": {
        target: process.env.VITE_API_URL || "http://127.0.0.1:8765",
        changeOrigin: true,
      },
    },
  },
});
