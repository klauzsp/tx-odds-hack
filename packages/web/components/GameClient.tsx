"use client";

import { useEffect, useRef, useState } from "react";
import type { GameFixture, QuestionType, SessionState, TeamCode } from "@nextgoal/shared";
import {
  DEMO_FIXTURES,
  ENTRY_LAMPORTS,
  ENTRY_WINDOW_MS,
  TEAM_CODES,
} from "@nextgoal/shared";
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
  const [fixtureId, setFixtureId] = useState(DEMO_FIXTURES[0].id);
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
    let timer: number | null = null;
    let openingTimer: number | null = null;
    const refresh = () => {
      getEscrowSnapshot(connection, wallet, state.escrowId)
        .then((snapshot) => active && setEscrow(snapshot))
        .catch(() => active && setEscrow(null));
    };
    const beginPolling = () => {
      refresh();
      // A deposit does not pass through Socket.IO, so lobby clients poll the
      // PDA to enable kickoff as soon as another wallet funds its entry.
      if (state.status === "lobby") timer = window.setInterval(refresh, 2_500);
    };

    const opensAt = fixtureEntryOpensAt(state.fixture);
    if (state.status === "lobby" && opensAt > Date.now()) {
      setEscrow(null);
      openingTimer = window.setTimeout(beginPolling, opensAt - Date.now());
    } else {
      beginPolling();
    }

    return () => {
      active = false;
      if (timer) window.clearInterval(timer);
      if (openingTimer) window.clearTimeout(openingTimer);
    };
  }, [
    connection,
    state?.escrowId,
    state?.fixture.startsAt,
    state?.fixture.status,
    state?.status,
    wallet,
  ]);

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
    getSocket().emit("session:create", { name, wallet: walletAddress, fixtureId }, (ack) => {
      if (!ack.ok) return setError(ack.error);
      joinedRef.current = { code: ack.code, name, wallet: walletAddress };
      setPlayerId(ack.playerId);
      setState(ack.state);
      if (ack.state.fixture.status === "historical") {
        void fundPrizePool(ack.state, ack.playerId);
      }
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
        if (ack.state.fixture.status === "historical") {
          void fundPrizePool(ack.state, ack.playerId);
        }
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
        fixtureId={fixtureId}
        setFixtureId={setFixtureId}
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
  fixtureId: number;
  setFixtureId: (v: number) => void;
  onCreate: () => void;
  onJoin: () => void;
  walletConnected: boolean;
  chainBusy: boolean;
  error: string | null;
}) {
  const now = useCurrentTime();
  const selectedFixture =
    DEMO_FIXTURES.find((fixture) => fixture.id === props.fixtureId) ?? DEMO_FIXTURES[0];
  const historical = DEMO_FIXTURES.filter((fixture) => fixture.status === "historical");
  const upcoming = DEMO_FIXTURES.filter((fixture) => fixture.status === "upcoming");

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
          <span>Choose a match</span>
          <select
            value={props.fixtureId}
            onChange={(event) => props.setFixtureId(Number(event.target.value))}
          >
            <optgroup label="Historical replays">
              {historical.map((fixture) => (
                <option key={fixture.id} value={fixture.id}>
                  {fixture.home.flag} {fixture.home.name} vs {fixture.away.name}{" "}
                  {fixture.away.flag}
                </option>
              ))}
            </optgroup>
            <optgroup label="Upcoming matches">
              {upcoming.map((fixture) => (
                <option key={fixture.id} value={fixture.id}>
                  {fixture.stage ? `${fixture.stage}: ` : ""}
                  {fixture.home.flag} {fixture.home.name} vs {fixture.away.name}{" "}
                  {fixture.away.flag} · {fixtureCountdown(fixture, now)}
                </option>
              ))}
            </optgroup>
          </select>
        </label>

        <div className={`fixturePreview ${selectedFixture.status}`}>
          <span className="fixturePreviewTeams">
            {selectedFixture.home.flag} {selectedFixture.home.name}
            <span className="muted"> vs </span>
            {selectedFixture.away.name} {selectedFixture.away.flag}
          </span>
          <span className="fixturePreviewMeta">
            {selectedFixture.status === "historical"
              ? "Historical replay · full match data"
              : upcomingFixtureLabel(selectedFixture, now)}
          </span>
          {selectedFixture.startsAt && (
            <span className="fixtureDate">{formatFixtureDate(selectedFixture.startsAt)}</span>
          )}
        </div>

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
          {!props.walletConnected
            ? "Connect wallet to play"
            : selectedFixture.status === "upcoming"
              ? "Create pending session · no deposit yet"
              : "Create a session · 0.1 SOL"}
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
  const now = useCurrentTime();
  const isHost = playerId === state.hostId;
  const me = state.players.find((player) => player.id === playerId);
  const deposited = Boolean(me && props.escrow?.depositors.includes(me.wallet));
  const allDeposited = state.players.every((player) =>
    props.escrow?.depositors.includes(player.wallet),
  );
  const waitingForKickoff = Boolean(
    state.fixture.status === "upcoming" &&
      state.fixture.startsAt &&
      now < state.fixture.startsAt,
  );
  const entryOpensAt = fixtureEntryOpensAt(state.fixture);
  const entryOpen = now >= entryOpensAt;
  const waitingForHostEscrow = entryOpen && !isHost && !props.escrow;
  const ready = state.players.length >= 2 && allDeposited && !waitingForKickoff;

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
          <span>
            {state.fixture.home.flag} {state.fixture.home.name}
          </span>
          <span className="muted">vs</span>
          <span>
            {state.fixture.away.name} {state.fixture.away.flag}
          </span>
        </div>
        <p className={`fixtureTiming ${state.fixture.status}`}>
          {state.fixture.status === "historical"
            ? "Historical replay"
            : upcomingFixtureLabel(state.fixture, now)}
        </p>

        <div className="escrowPanel">
          <div>
            <span className="escrowLabel">Prize pool · Solana devnet</span>
            <strong>
              {((props.escrow?.prizePoolLamports ?? 0) / 1_000_000_000).toFixed(2)} SOL
            </strong>
          </div>
          <span className={`fundingStatus ${deposited ? "funded" : ""}`}>
            {deposited
              ? "Your entry is funded ✓"
              : entryOpen
                ? "Entry not funded"
                : `Deposits open ${formatTimeUntil(entryOpensAt, now)}`}
          </span>
        </div>

        {!deposited && (
          <button
            className="btn"
            onClick={props.onDeposit}
            disabled={props.chainBusy || !entryOpen || waitingForHostEscrow}
          >
            {props.chainBusy
              ? "Confirming on Solana…"
              : !entryOpen
                ? `Deposits open ${formatTimeUntil(entryOpensAt, now)}`
                : waitingForHostEscrow
                  ? "Waiting for host to open prize pool…"
                  : `Deposit ${(ENTRY_LAMPORTS / 1_000_000_000).toFixed(1)} SOL`}
          </button>
        )}

        {isHost ? (
          <button className="btn primary" onClick={props.onStart} disabled={!ready}>
            {ready
              ? "Kick off ⚽"
              : waitingForKickoff
                ? `Starts ${fixtureCountdown(state.fixture, now)}`
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

function useCurrentTime(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function fixtureCountdown(fixture: GameFixture, now: number): string {
  if (!fixture.startsAt) return "available now";
  const remaining = fixture.startsAt - now;
  if (remaining <= 0) return "live now";

  const totalMinutes = Math.max(1, Math.ceil(remaining / 60_000));
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [
    days ? `${days}d` : "",
    hours ? `${hours}h` : "",
    minutes && !days ? `${minutes}m` : "",
  ].filter(Boolean);
  return `in ${parts.join(" ")}`;
}

function fixtureEntryOpensAt(fixture: GameFixture): number {
  if (fixture.status === "historical" || !fixture.startsAt) return 0;
  return fixture.startsAt - ENTRY_WINDOW_MS;
}

function formatTimeUntil(timestamp: number, now: number): string {
  const totalMinutes = Math.max(1, Math.ceil((timestamp - now) / 60_000));
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  return `in ${[
    days ? `${days}d` : "",
    hours ? `${hours}h` : "",
    minutes && !days ? `${minutes}m` : "",
  ]
    .filter(Boolean)
    .join(" ")}`;
}

function upcomingFixtureLabel(fixture: GameFixture, now: number): string {
  const stage = fixture.stage ?? "Upcoming match";
  if (!fixture.startsAt || now >= fixture.startsAt) return `${stage} · live feed ready`;
  return `${stage} · pending · ${fixtureCountdown(fixture, now)}`;
}

function formatFixtureDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
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
  const team = (code: TeamCode) =>
    code === "HOME" ? state.fixture.home : state.fixture.away;

  return (
    <main className="shell wide">
      <header className="scoreboard">
        <div className="teamSide">
          <span className="teamFlag">{state.fixture.home.flag}</span>
          <span className="teamName">{state.fixture.home.name}</span>
        </div>
        <div className="scoreCenter">
          <span className="scoreLine">
            {state.score.HOME} – {state.score.AWAY}
          </span>
          <span className={`clock ${state.status === "finished" ? "ft" : ""}`}>
            {state.status === "finished" ? "FULL TIME" : `${state.minute}'`}
          </span>
        </div>
        <div className="teamSide right">
          <span className="teamName">{state.fixture.away.name}</span>
          <span className="teamFlag">{state.fixture.away.flag}</span>
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
                      <span className="answerFlag">{team(code).flag}</span>
                      <span className="answerName">{team(code).name}</span>
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
                    {pick ? `you: ${team(pick).name}` : "no pick"} · awaiting…
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
                            {playerName(entry.playerId)} picked {team(entry.team).name}
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
                      `GOAL! ${event.scorer ? `${event.scorer} (${team(event.team).name})` : team(event.team).name}`}
                    {event.kind === "CARD" &&
                      `${event.card === "red" ? "🟥" : "🟨"} ${event.player || team(event.team).name}${event.player ? ` (${team(event.team).name})` : ""}`}
                    {event.kind === "CORNER" && `Corner — ${team(event.team).name}`}
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
