"use client";

import { useEffect, useRef, useState } from "react";
import type { QuestionType, SessionState, TeamCode } from "@nextgoal/shared";
import { ENTRY_LAMPORTS, TEAMS, TEAM_CODES } from "@nextgoal/shared";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  ensureEscrowDeposit,
  getEscrowSnapshot,
  type EscrowSnapshot,
} from "../lib/escrow";

const QUESTION_EMOJI: Record<QuestionType, string> = {
  NEXT_GOAL: "⚽",
  NEXT_CARD: "🟨",
  NEXT_CORNER: "🚩",
};
import { getSocket } from "../lib/socket";

export default function GameClient() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [state, setState] = useState<SessionState | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [escrow, setEscrow] = useState<EscrowSnapshot | null>(null);
  const [chainBusy, setChainBusy] = useState(false);
  const joinedRef = useRef<{ code: string; name: string; wallet: string } | null>(null);

  useEffect(() => {
    const socket = getSocket();
    socket.on("state", setState);
    // If the socket drops mid-match, rejoin by name to reclaim our seat.
    const onReconnect = () => {
      const joined = joinedRef.current;
      if (!joined) return;
      socket.emit("session:join", joined, (ack) => {
        if (ack.ok) {
          setPlayerId(ack.playerId);
          setState(ack.state);
        }
      });
    };
    socket.io.on("reconnect", onReconnect);
    return () => {
      socket.off("state", setState);
      socket.io.off("reconnect", onReconnect);
    };
  }, []);

  useEffect(() => {
    if (!state?.escrowId || !wallet) return;
    let active = true;
    const refresh = () => {
      getEscrowSnapshot(connection, wallet, state.escrowId)
        .then((snapshot) => active && setEscrow(snapshot))
        .catch(() => active && setEscrow(null));
    };
    refresh();
    // A deposit does not pass through Socket.IO, so lobby clients poll the PDA
    // briefly to enable kickoff as soon as another wallet funds its entry.
    const timer = state.status === "lobby" ? window.setInterval(refresh, 2_500) : null;
    return () => {
      active = false;
      if (timer) window.clearInterval(timer);
    };
  }, [connection, state?.escrowId, state?.status, wallet]);

  const fundPrizePool = async (session: SessionState, id: string) => {
    if (!wallet) return setError("Connect your Phantom wallet first.");
    setChainBusy(true);
    setError(null);
    try {
      await ensureEscrowDeposit(
        connection,
        wallet,
        session.escrowId,
        id === session.hostId,
      );
      setEscrow(await getEscrowSnapshot(connection, wallet, session.escrowId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The escrow transaction failed.");
    } finally {
      setChainBusy(false);
    }
  };

  const create = () => {
    if (!wallet) return setError("Connect your Phantom wallet first.");
    setError(null);
    const walletAddress = wallet.publicKey.toBase58();
    getSocket().emit("session:create", { name, wallet: walletAddress }, (ack) => {
      if (!ack.ok) return setError(ack.error);
      joinedRef.current = { code: ack.code, name, wallet: walletAddress };
      setPlayerId(ack.playerId);
      setState(ack.state);
      void fundPrizePool(ack.state, ack.playerId);
    });
  };

  const join = () => {
    if (!wallet) return setError("Connect your Phantom wallet first.");
    setError(null);
    const walletAddress = wallet.publicKey.toBase58();
    getSocket().emit(
      "session:join",
      { code: codeInput.trim().toUpperCase(), name, wallet: walletAddress },
      (ack) => {
        if (!ack.ok) return setError(ack.error);
        joinedRef.current = { code: ack.code, name, wallet: walletAddress };
        setPlayerId(ack.playerId);
        setState(ack.state);
        void fundPrizePool(ack.state, ack.playerId);
      },
    );
  };

  const startMatch = () => {
    setError(null);
    getSocket().emit("match:start", (ack) => {
      if (!ack.ok) setError(ack.error);
    });
  };

  const predict = (team: TeamCode) => {
    if (!state?.question) return;
    setError(null);
    getSocket().emit("prediction:submit", { questionId: state.question.id, team }, (ack) => {
      if (!ack.ok) setError(ack.error);
    });
  };

  if (!state || !playerId) {
    return (
      <HomeScreen
        name={name}
        setName={setName}
        codeInput={codeInput}
        setCodeInput={setCodeInput}
        onCreate={create}
        onJoin={join}
        walletConnected={Boolean(wallet)}
        chainBusy={chainBusy}
        error={error}
      />
    );
  }

  if (state.status === "lobby") {
    return (
      <LobbyScreen
        state={state}
        playerId={playerId}
        escrow={escrow}
        chainBusy={chainBusy}
        onDeposit={() => fundPrizePool(state, playerId)}
        onStart={startMatch}
        error={error}
      />
    );
  }

  return (
    <MatchScreen
      state={state}
      playerId={playerId}
      escrow={escrow}
      onPredict={predict}
      error={error}
    />
  );
}

function HomeScreen(props: {
  name: string;
  setName: (v: string) => void;
  codeInput: string;
  setCodeInput: (v: string) => void;
  onCreate: () => void;
  onJoin: () => void;
  walletConnected: boolean;
  chainBusy: boolean;
  error: string | null;
}) {
  return (
    <main className="shell">
      <div className="hero">
        <span className="badge">World Cup 2026 · powered by TXODDS</span>
        <h1>
          Next<span className="accent">Goal</span>
        </h1>
        <p className="tagline">
          Call the next goal before your friends do. Correct picks pay out points at live
          odds — most points at full time takes the pot.
        </p>
      </div>

      <div className="card">
        <label className="field">
          <span>Your name</span>
          <input
            value={props.name}
            onChange={(e) => props.setName(e.target.value)}
            placeholder="e.g. Sam"
            maxLength={20}
          />
        </label>

        <button
          className="btn primary"
          onClick={props.onCreate}
          disabled={!props.name.trim() || !props.walletConnected || props.chainBusy}
        >
          {props.walletConnected ? "Create a session · 0.1 SOL" : "Connect wallet to play"}
        </button>

        <div className="divider">or join a friend</div>

        <div className="joinRow">
          <input
            value={props.codeInput}
            onChange={(e) => props.setCodeInput(e.target.value.toUpperCase())}
            placeholder="CODE"
            maxLength={4}
            className="codeInput"
          />
          <button
            className="btn"
            onClick={props.onJoin}
            disabled={
              !props.name.trim() ||
              props.codeInput.trim().length < 4 ||
              !props.walletConnected ||
              props.chainBusy
            }
          >
            Join
          </button>
        </div>

        {props.error && <p className="error">{props.error}</p>}
      </div>
    </main>
  );
}

function LobbyScreen(props: {
  state: SessionState;
  playerId: string;
  escrow: EscrowSnapshot | null;
  chainBusy: boolean;
  onDeposit: () => void;
  onStart: () => void;
  error: string | null;
}) {
  const { state, playerId } = props;
  const isHost = playerId === state.hostId;
  const me = state.players.find((player) => player.id === playerId);
  const deposited = Boolean(me && props.escrow?.depositors.includes(me.wallet));
  const allDeposited = state.players.every((player) =>
    props.escrow?.depositors.includes(player.wallet),
  );
  const ready = state.players.length >= 2 && allDeposited;

  return (
    <main className="shell">
      <div className="card lobby">
        <p className="lobbyLabel">Session code</p>
        <p className="sessionCode">{state.code}</p>
        <p className="muted">Share this code with your friend</p>

        <div className="slots">
          {[0, 1].map((i) => {
            const player = state.players[i];
            return (
              <div key={i} className={`slot ${player ? "filled" : ""}`}>
                {player ? (
                  <>
                    <span className="slotName">{player.name}</span>
                    {player.id === state.hostId && <span className="hostTag">host</span>}
                  </>
                ) : (
                  <span className="muted">Waiting…</span>
                )}
              </div>
            );
          })}
        </div>

        <div className="fixtureBanner">
          <span>{TEAMS.ENG.flag} England</span>
          <span className="muted">vs</span>
          <span>Mexico {TEAMS.MEX.flag}</span>
        </div>

        <div className="escrowPanel">
          <div>
            <span className="escrowLabel">Prize pool · Solana devnet</span>
            <strong>
              {((props.escrow?.prizePoolLamports ?? 0) / 1_000_000_000).toFixed(2)} SOL
            </strong>
          </div>
          <span className={`fundingStatus ${deposited ? "funded" : ""}`}>
            {deposited ? "Your entry is funded ✓" : "Entry not funded"}
          </span>
        </div>

        {!deposited && (
          <button className="btn" onClick={props.onDeposit} disabled={props.chainBusy}>
            {props.chainBusy
              ? "Confirming on Solana…"
              : `Deposit ${(ENTRY_LAMPORTS / 1_000_000_000).toFixed(1)} SOL`}
          </button>
        )}

        {isHost ? (
          <button className="btn primary" onClick={props.onStart} disabled={!ready}>
            {ready
              ? "Kick off ⚽"
              : state.players.length < 2
                ? "Waiting for a second player…"
                : "Waiting for both deposits…"}
          </button>
        ) : (
          <p className="muted">Waiting for the host to kick off…</p>
        )}

        {props.error && <p className="error">{props.error}</p>}
      </div>
    </main>
  );
}

function MatchScreen(props: {
  state: SessionState;
  playerId: string;
  escrow: EscrowSnapshot | null;
  onPredict: (team: TeamCode) => void;
  error: string | null;
}) {
  const { state, playerId } = props;
  const me = state.players.find((p) => p.id === playerId);
  const question = state.question;
  const myPick = question ? (state.predictions[question.id]?.[playerId] ?? null) : null;
  const playerName = (id: string) =>
    state.players.find((p) => p.id === id)?.name ?? "Unknown";

  return (
    <main className="shell wide">
      <header className="scoreboard">
        <div className="teamSide">
          <span className="teamFlag">{TEAMS.ENG.flag}</span>
          <span className="teamName">England</span>
        </div>
        <div className="scoreCenter">
          <span className="scoreLine">
            {state.score.ENG} – {state.score.MEX}
          </span>
          <span className={`clock ${state.status === "finished" ? "ft" : ""}`}>
            {state.status === "finished" ? "FULL TIME" : `${state.minute}'`}
          </span>
        </div>
        <div className="teamSide right">
          <span className="teamName">Mexico</span>
          <span className="teamFlag">{TEAMS.MEX.flag}</span>
        </div>
      </header>

      <div className="columns">
        <section className="mainCol">
          {state.status === "finished" ? (
            <FinalCard
              state={state}
              playerId={playerId}
              escrow={props.escrow}
            />
          ) : question ? (
            <div className="card questionCard">
              <div className="questionHeader">
                <span className="questionEmoji">{QUESTION_EMOJI[question.type]}</span>
                <p className="questionText">{question.text}</p>
                <span className="lockTimer">
                  locks {Math.max(0, question.lockAtMinute - state.minute)}&apos;
                </span>
              </div>
              <div className="answerRow">
                {TEAM_CODES.map((code) => {
                  const picked = myPick === code;
                  return (
                    <button
                      key={code}
                      className={`answerBtn ${picked ? "picked" : ""} ${
                        myPick && !picked ? "dimmed" : ""
                      }`}
                      onClick={() => props.onPredict(code)}
                      disabled={myPick !== null}
                    >
                      <span className="answerFlag">{TEAMS[code].flag}</span>
                      <span className="answerName">{TEAMS[code].name}</span>
                      <span className="answerOdds">
                        {question.type === "NEXT_GOAL"
                          ? `pays ${Math.round(100 * state.odds[code])} pts`
                          : "pays 150 pts"}
                      </span>
                      {picked && <span className="lockedTag">locked in</span>}
                    </button>
                  );
                })}
              </div>
              <div className="pickStatus">
                {state.players
                  .filter((p) => p.id !== playerId)
                  .map((p) => (
                    <span key={p.id} className="muted">
                      {p.name}:{" "}
                      {state.predictions[question.id]?.[p.id] ? "locked in 🔒" : "thinking…"}
                    </span>
                  ))}
              </div>
            </div>
          ) : (
            <div className="card waitingCard">
              <p className="muted">
                Eyes on the match — the next question drops any minute…
              </p>
            </div>
          )}

          {state.status !== "finished" && state.pendingQuestions.length > 0 && (
            <div className="pendingRow">
              {state.pendingQuestions.map((q) => {
                const pick = state.predictions[q.id]?.[playerId];
                return (
                  <span key={q.id} className="pendingChip">
                    {QUESTION_EMOJI[q.type]} {q.text.replace("?", "")} —{" "}
                    {pick ? `you: ${TEAMS[pick].name}` : "no pick"} · awaiting…
                  </span>
                );
              })}
            </div>
          )}

          {state.lastResult && state.status !== "finished" && (
            <div className="card resultCard">
              {state.lastResult.team ? (
                <>
                  <p className="resultHeadline">{state.lastResult.headline}</p>
                  <p className="muted small">{state.lastResult.text}</p>
                  {state.lastResult.entries.length === 0 ? (
                    <p className="muted">Nobody locked in a pick.</p>
                  ) : (
                    <ul className="resultList">
                      {state.lastResult.entries.map((entry) => (
                        <li key={entry.playerId}>
                          <span>
                            {playerName(entry.playerId)} picked {TEAMS[entry.team].name}
                          </span>
                          <span className={entry.points > 0 ? "gain" : "muted"}>
                            {entry.points > 0 ? `+${entry.points} pts` : "+0"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p className="muted">{state.lastResult.headline}</p>
              )}
            </div>
          )}

          {props.error && <p className="error">{props.error}</p>}
        </section>

        <aside className="sideCol">
          <div className="card">
            <p className="cardTitle">Scores</p>
            <ul className="scoreList">
              {[...state.players]
                .sort((a, b) => b.score - a.score)
                .map((p) => (
                  <li key={p.id} className={p.id === playerId ? "me" : ""}>
                    <span>
                      {p.name}
                      {p.id === playerId && " (you)"}
                      {!p.connected && " ⚠︎"}
                    </span>
                    <span className="pts">{p.score}</span>
                  </li>
                ))}
            </ul>
            {me && <p className="muted small">Points pay out at TXODDS live odds.</p>}
          </div>

          <div className="card feedCard">
            <p className="cardTitle">Match feed</p>
            <ul className="feedList">
              {[...state.feed].reverse().map((event, i) => (
                <li key={i} className={event.kind === "GOAL" ? "goalEvent" : ""}>
                  <span className="feedMinute">{event.minute}&apos;</span>
                  <span>
                    {event.kind === "KICKOFF" && "Kick-off!"}
                    {event.kind === "HALF_TIME" && "Half-time."}
                    {event.kind === "FULL_TIME" && "Full-time."}
                    {event.kind === "GOAL" &&
                      `GOAL! ${event.scorer ? `${event.scorer} (${TEAMS[event.team].name})` : TEAMS[event.team].name}`}
                    {event.kind === "CARD" &&
                      `${event.card === "red" ? "🟥" : "🟨"} ${event.player || TEAMS[event.team].name}${event.player ? ` (${TEAMS[event.team].name})` : ""}`}
                    {event.kind === "CORNER" && `Corner — ${TEAMS[event.team].name}`}
                    {event.kind === "COMMENTARY" && event.text}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </main>
  );
}

function FinalCard({
  state,
  playerId,
  escrow,
}: {
  state: SessionState;
  playerId: string;
  escrow: EscrowSnapshot | null;
}) {
  const winners = state.winners ?? [];
  const winnerNames = state.players
    .filter((p) => winners.includes(p.id))
    .map((p) => p.name);
  const iWon = winners.includes(playerId);
  const tie = winners.length > 1;
  const settled = state.results.filter((r) => r.team !== null);
  const correctCount = (pid: string) =>
    settled.filter((r) => r.entries.some((e) => e.playerId === pid && e.points > 0)).length;

  return (
    <div className="card finalCard">
      <p className="trophy">🏆</p>
      <h2>
        {tie
          ? `It's a tie: ${winnerNames.join(" & ")}`
          : `${winnerNames[0]} wins the pot!`}
      </h2>
      <p className="muted">
        {iWon && !tie ? "The SOL prize pot is yours." : tie ? "Pot splits down the middle." : "Better luck next match."}
      </p>
      <ul className="scoreList final">
        {[...state.players]
          .sort((a, b) => b.score - a.score)
          .map((p) => (
            <li key={p.id} className={winners.includes(p.id) ? "me" : ""}>
              <span>
                {p.name}{" "}
                <span className="muted small">
                  ({correctCount(p.id)}/{settled.length} correct)
                </span>
              </span>
              <span className="pts">{p.score} pts</span>
            </li>
          ))}
      </ul>
      {state.payoutSignature ? (
        <a
          className="explorerLink"
          href={`https://explorer.solana.com/tx/${state.payoutSignature}?cluster=devnet`}
          target="_blank"
          rel="noreferrer"
        >
          Prize paid on Solana ↗
        </a>
      ) : (
        <p className="muted small">
          Application payout in progress
          {escrow
            ? ` · ${(escrow.prizePoolLamports / 1_000_000_000).toFixed(2)} SOL`
            : "…"}
        </p>
      )}
    </div>
  );
}
