import type { Duplex } from "node:stream";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { getSession } from "@/lib/server/session";
import type { ClientIntent, ServerEvent } from "@/lib/protocol";

type Flagged = Server & { __simulityWs?: boolean; __simulityMcp?: boolean };

export function attachWs(httpServer: Server) {
  const s = httpServer as Flagged;
  if (!s.__simulityWs) {
    s.__simulityWs = true;
    const wss = new WebSocketServer({ noServer: true });
    httpServer.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = req.url ?? "";
      if (!url.startsWith("/ws")) return;
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    });
    wss.on("connection", (ws: WebSocket) => {
      const session = getSession();
      const sock = {
        send: (ev: ServerEvent) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(ev));
        },
      };
      session.attach(sock);
      ws.on("message", (data) => {
        try {
          const intent = JSON.parse(String(data)) as ClientIntent;
          void session.handle(intent, sock);
        } catch {
          sock.send({ type: "error", error: "Bad intent." });
        }
      });
      ws.on("close", () => session.detach(sock));
    });
  }
  attachMcp(httpServer);
}

export function attachMcp(httpServer: Server) {
  const s = httpServer as Flagged;
  if (s.__simulityMcp) return;
  s.__simulityMcp = true;
  httpServer.on("request", (req: IncomingMessage, res: ServerResponse) => {
    const url = (req.url ?? "").split("?")[0];
    if (url !== "/mcp") return;
    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ tools: ["list_souls", "list_places", "move_soul", "call_soul", "assign_task"] }));
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "POST only." }));
      return;
    }
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 256 * 1024) req.destroy();
    });
    req.on("end", () => {
      void (async () => {
        try {
          const { handleMcp } = await import("@/lib/server/mcp");
          const parsed = JSON.parse(body || "{}") as { tool?: string; args?: Record<string, unknown>; method?: string; params?: Record<string, unknown> };
          const tool = parsed.tool ?? parsed.method ?? "";
          const args = parsed.args ?? parsed.params ?? {};
          const out = await handleMcp(getSession(), tool, args);
          res.writeHead(out.ok ? 200 : 400, { "Content-Type": "application/json" });
          res.end(JSON.stringify(out));
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "Bad MCP call." }));
        }
      })();
    });
  });
}
