import { createServer } from "node:http";
import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@nextgoal/shared";
import { Session, SessionStore } from "./session";

const PORT = Number(process.env.PORT ?? 3001);

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("NextGoal game server");
});

interface SocketData {
  code?: string;
  playerId?: string;
}

const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(
  httpServer,
  { cors: { origin: "*" } },
);

const store = new SessionStore((session: Session) => {
  io.to(session.code).emit("state", session.toState());
});

io.on("connection", (socket) => {
  socket.on("session:create", ({ name }, cb) => {
    const session = store.create();
    const result = session.join(name);
    if (!result.ok) return cb(result);
    socket.data.code = session.code;
    socket.data.playerId = result.playerId;
    socket.join(session.code);
    cb({ ok: true, playerId: result.playerId, code: session.code, state: session.toState() });
  });

  socket.on("session:join", ({ code, name }, cb) => {
    const session = store.get(code);
    if (!session) return cb({ ok: false, error: "No session with that code." });
    const result = session.join(name);
    if (!result.ok) return cb(result);
    socket.data.code = session.code;
    socket.data.playerId = result.playerId;
    socket.join(session.code);
    cb({ ok: true, playerId: result.playerId, code: session.code, state: session.toState() });
  });

  socket.on("match:start", (cb) => {
    const session = socket.data.code ? store.get(socket.data.code) : undefined;
    if (!session || !socket.data.playerId)
      return cb({ ok: false, error: "Join a session first." });
    cb(session.start(socket.data.playerId));
  });

  socket.on("prediction:submit", ({ questionId, team }, cb) => {
    const session = socket.data.code ? store.get(socket.data.code) : undefined;
    if (!session || !socket.data.playerId)
      return cb({ ok: false, error: "Join a session first." });
    cb(session.submitPrediction(socket.data.playerId, questionId, team));
  });

  socket.on("disconnect", () => {
    if (!socket.data.code || !socket.data.playerId) return;
    store.get(socket.data.code)?.markDisconnected(socket.data.playerId);
  });
});

httpServer.listen(PORT, () => {
  console.log(`⚽ NextGoal game server listening on http://localhost:${PORT}`);
});
