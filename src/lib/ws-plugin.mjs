/** Vite plugin: attach the Simulity WebSocket host to the same HTTP server as :8080. */
export function simulityWsPlugin() {
  return {
    name: "simulity:ws",
    apply: "serve",
    async configureServer(server) {
      try {
        const mod = await server.ssrLoadModule("/src/lib/server/ws.ts");
        if (server.httpServer && typeof mod.attachWs === "function") {
          mod.attachWs(server.httpServer);
        } else {
          server.httpServer?.once("listening", () => {
            if (server.httpServer) mod.attachWs(server.httpServer);
          });
        }
      } catch (err) {
        console.error("[simulity] ws attach failed:", err);
      }
    },
  };
}