import type { Duplex } from "node:stream";
import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { getSession } from "@/lib/server/session";
import type { ClientIntent, ServerEvent } from "@/lib/protocol";

type Flagged = Server & { __simulityWs?: boolean };

export function attachWs(httpServer: Server) {
  const s = httpServer as Flagged;
  if (s.__simulityWs) return;
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