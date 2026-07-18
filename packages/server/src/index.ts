import { createServer } from "node:http";
import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@matchpot/shared";
import { Session, SessionStore } from "./session";
import {
  lockEscrowForKickoff,
  refundExpiredEscrow,
  settleFinishedEscrow,
  verifyEscrowReady,
} from "./escrow";

const PORT = Number(process.env.PORT ?? 3001);

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("MatchPot game server");
});

interface SocketData {
  code?: string;
  playerId?: string;
}

const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(
  httpServer,
  { cors: { origin: "*" } },
);

const settling = new Set<string>();
const refunding = new Set<string>();

function maybeSettle(session: Session) {
  const state = session.toState();
  if (
    state.mode === "practice" ||
    state.status !== "finished" ||
    state.payoutSignature ||
    settling.has(state.escrowId)
  )
    return;

  settling.add(state.escrowId);
  void settleFinishedEscrow(state)
    .then((signature) => {
      console.log(`💸 Settled ${state.code}: ${signature}`);
      session.recordPayout(signature);
    })
    .catch((error) => {
      console.error(`Escrow settlement failed for ${state.code}:`, error);
      setTimeout(() => {
        settling.delete(state.escrowId);
        maybeSettle(session);
      }, 5_000);
    });
}

function maybeRefund(session: Session) {
  const state = session.toState();
  if (state.status !== "expired" || state.refundComplete || refunding.has(state.escrowId)) return;

  refunding.add(state.escrowId);
  void refundExpiredEscrow(state)
    .then((signature) => {
      if (signature) console.log(`💸 Refunded expired session ${state.code}: ${signature}`);
      session.recordRefund(signature);
    })
    .catch((error) => {
      console.error(`Expired escrow refund failed for ${state.code}:`, error);
      setTimeout(() => {
        refunding.delete(state.escrowId);
        maybeRefund(session);
      }, 5_000);
    });
}

const store = new SessionStore((session: Session) => {
  io.to(session.code).emit("state", session.toState());
  maybeSettle(session);
  maybeRefund(session);
});

io.on("connection", (socket) => {
  socket.on("session:create", ({ name, wallet, fixtureId, mode }, cb) => {
    const session = store.create(fixtureId, mode);
    if (!session) return cb({ ok: false, error: "Choose one of the available matches." });
    const result = session.join(name, wallet);
    if (!result.ok) return cb(result);
    if (mode === "practice") session.addBot();
    socket.data.code = session.code;
    socket.data.playerId = result.playerId;
    socket.join(session.code);
    cb({ ok: true, playerId: result.playerId, code: session.code, state: session.toState() });
  });

  socket.on("session:join", ({ code, name, wallet }, cb) => {
    const session = store.get(code);
    if (!session) return cb({ ok: false, error: "No session with that code." });
    const result = session.join(name, wallet);
    if (!result.ok) return cb(result);
    socket.data.code = session.code;
    socket.data.playerId = result.playerId;
    socket.join(session.code);
    cb({ ok: true, playerId: result.playerId, code: session.code, state: session.toState() });
  });

  socket.on("match:start", async (cb) => {
    const session = socket.data.code ? store.get(socket.data.code) : undefined;
    if (!session || !socket.data.playerId)
      return cb({ ok: false, error: "Join a session first." });
    const startReservation = session.beginStart(socket.data.playerId);
    if (!startReservation.ok) return cb(startReservation);
    if (session.mode === "practice") return cb(session.start(socket.data.playerId));
    const escrowError = await verifyEscrowReady(session.toState());
    if (escrowError) {
      session.abortStart();
      return cb({ ok: false, error: escrowError });
    }
    try {
      await lockEscrowForKickoff(session.toState());
    } catch (error) {
      console.error(`Could not lock escrow for ${session.code}:`, error);
      session.abortStart();
      return cb({ ok: false, error: "Could not lock the prize pool for kickoff. Try again." });
    }
    cb(session.start(socket.data.playerId));
  });

  socket.on("session:leave", (cb) => {
    if (socket.data.code) socket.leave(socket.data.code);
    delete socket.data.code;
    delete socket.data.playerId;
    cb({ ok: true });
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
  console.log(`⚽ MatchPot game server listening on http://localhost:${PORT}`);
});
