"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { GameFixture, QuestionType, SessionState, TeamCode } from "@matchpot/shared";
import QRCode from "qrcode";
import {
  DEMO_FIXTURES,
  ENTRY_LAMPORTS,
  ENTRY_WINDOW_MS,
  TEAM_CODES,
} from "@matchpot/shared";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  ensureEscrowDeposit,
  getEscrowSnapshot,
  type EscrowSnapshot,
} from "../lib/escrow";
import MatchPotLogo from "./MatchPotLogo";

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
  const [depositSignature, setDepositSignature] = useState<string | null>(null);
  const [chainBusy, setChainBusy] = useState(false);
  const [sessionAction, setSessionAction] = useState<"create" | "practice" | "join" | null>(null);
  const [startBusy, setStartBusy] = useState(false);
  const joinedRef = useRef<{ code: string; name: string; wallet: string } | null>(null);
  const startTimeoutRef = useRef<number | null>(null);
  const guestIdentityRef = useRef(`guest:${crypto.randomUUID()}`);

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
    const onConnectError = () => {
      setError("Cannot reach the MatchPot game server on port 3001. Restart with pnpm dev.");
    };
    socket.on("connect_error", onConnectError);
    return () => {
      socket.off("state", setState);
      socket.off("connect_error", onConnectError);
      socket.io.off("reconnect", onReconnect);
    };
  }, []);

  useEffect(() => {
    const inviteCode = new URLSearchParams(window.location.search).get("join");
    if (inviteCode) setCodeInput(inviteCode.trim().toUpperCase());
  }, []);

  useEffect(() => {
    if (!state?.escrowId || !wallet || state.mode === "practice") return;
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

  useEffect(() => {
    if (!startBusy || !state || (state.status === "lobby" && !state.feedError)) return;
    if (startTimeoutRef.current) window.clearTimeout(startTimeoutRef.current);
    startTimeoutRef.current = null;
    setStartBusy(false);
  }, [startBusy, state]);

  const fundPrizePool = async (session: SessionState, id: string) => {
    if (!wallet) return setError("Connect your Phantom wallet first.");
    setChainBusy(true);
    setError(null);
    try {
      const signature = await ensureEscrowDeposit(
        connection,
        wallet,
        session.escrowId,
        id === session.hostId,
      );
      if (signature) setDepositSignature(signature);
      setEscrow(await getEscrowSnapshot(connection, wallet, session.escrowId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The escrow transaction failed.");
    } finally {
      setChainBusy(false);
    }
  };

  const create = (mode: "competitive" | "practice") => {
    if (mode === "competitive" && !wallet)
      return setError("Connect your Phantom wallet first.");
    const socket = getSocket();
    if (!socket.connected) {
      socket.connect();
      return setError("Cannot reach the MatchPot game server on port 3001. Restart with pnpm dev.");
    }
    setError(null);
    setSessionAction(mode === "practice" ? "practice" : "create");
    const timeout = window.setTimeout(() => {
      setSessionAction(null);
      setError("Creating the session is taking too long. Check the game server and try again.");
    }, 8_000);
    const identity =
      mode === "practice" ? guestIdentityRef.current : wallet!.publicKey.toBase58();
    socket.emit("session:create", { name, wallet: identity, fixtureId, mode }, (ack) => {
      window.clearTimeout(timeout);
      setSessionAction(null);
      if (!ack.ok) return setError(ack.error);
      joinedRef.current = { code: ack.code, name, wallet: identity };
      setPlayerId(ack.playerId);
      setState(ack.state);
      if (ack.state.mode === "competitive" && ack.state.fixture.status === "historical") {
        void fundPrizePool(ack.state, ack.playerId);
      }
    });
  };

  const join = () => {
    if (!wallet) return setError("Connect your Phantom wallet first.");
    const socket = getSocket();
    if (!socket.connected) {
      socket.connect();
      return setError("Cannot reach the MatchPot game server on port 3001. Restart with pnpm dev.");
    }
    setError(null);
    setSessionAction("join");
    const timeout = window.setTimeout(() => {
      setSessionAction(null);
      setError("Joining the session is taking too long. Check the game server and try again.");
    }, 8_000);
    const walletAddress = wallet.publicKey.toBase58();
    socket.emit(
      "session:join",
      { code: codeInput.trim().toUpperCase(), name, wallet: walletAddress },
      (ack) => {
        window.clearTimeout(timeout);
        setSessionAction(null);
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
    setStartBusy(true);
    startTimeoutRef.current = window.setTimeout(() => {
      startTimeoutRef.current = null;
      setStartBusy(false);
      setError("Kickoff is taking longer than expected. Check Solana and try again.");
    }, 20_000);
    getSocket().emit("match:start", (ack) => {
      if (!ack.ok) {
        if (startTimeoutRef.current) window.clearTimeout(startTimeoutRef.current);
        startTimeoutRef.current = null;
        setStartBusy(false);
        setError(ack.error);
      }
    });
  };

  const playAgain = () => {
    joinedRef.current = null;
    getSocket().emit("session:leave", () => undefined);
    setState(null);
    setPlayerId(null);
    setEscrow(null);
    setDepositSignature(null);
    setCodeInput("");
    window.history.replaceState({}, "", window.location.pathname);
    setSessionAction(null);
    if (startTimeoutRef.current) window.clearTimeout(startTimeoutRef.current);
    startTimeoutRef.current = null;
    setStartBusy(false);
    setError(null);
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
        onCreateCompetitive={() => create("competitive")}
        onCreatePractice={() => create("practice")}
        onJoin={join}
        walletConnected={Boolean(wallet)}
        chainBusy={chainBusy}
        sessionAction={sessionAction}
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
        depositSignature={depositSignature}
        chainBusy={chainBusy}
        startBusy={startBusy}
        onDeposit={() => fundPrizePool(state, playerId)}
        onStart={startMatch}
        error={error}
      />
    );
  }

  if (state.status === "expired") {
    return <ExpiredScreen state={state} onPlayAgain={playAgain} />;
  }

  return (
    <MatchScreen
      state={state}
      playerId={playerId}
      escrow={escrow}
      onPredict={predict}
      onPlayAgain={playAgain}
      error={error}
    />
  );
}

function ExpiredScreen({
  state,
  onPlayAgain,
}: {
  state: SessionState;
  onPlayAgain: () => void;
}) {
  return (
    <main className="shell">
      <div className="card finalCard">
        <p className="trophy">⏱️</p>
        <h2>Session expired</h2>
        <p className="muted">
          Both entries were not funded within five minutes of kickoff, so this match did
          not start.
        </p>
        {!state.refundComplete ? (
          <p className="muted small">Checking the prize pool for deposits to refund…</p>
        ) : state.refundSignature ? (
          <a
            className="explorerLink"
            href={`https://explorer.solana.com/tx/${state.refundSignature}?cluster=devnet`}
            target="_blank"
            rel="noreferrer"
          >
            Deposits refunded on Solana ↗
          </a>
        ) : (
          <p className="muted small">No deposits were made, so no refund was needed.</p>
        )}
        <button className="btn primary playAgainBtn" onClick={onPlayAgain}>
          Choose another match
        </button>
      </div>
    </main>
  );
}

function HomeScreen(props: {
  name: string;
  setName: (v: string) => void;
  codeInput: string;
  setCodeInput: (v: string) => void;
  fixtureId: number;
  setFixtureId: (v: number) => void;
  onCreateCompetitive: () => void;
  onCreatePractice: () => void;
  onJoin: () => void;
  walletConnected: boolean;
  chainBusy: boolean;
  sessionAction: "create" | "practice" | "join" | null;
  error: string | null;
}) {
  const now = useCurrentTime();
  const selectedFixture =
    DEMO_FIXTURES.find((fixture) => fixture.id === props.fixtureId) ?? DEMO_FIXTURES[0];

  return (
    <main className="shell">
      <div className="hero">
        <MatchPotLogo size="hero" />
        <span className="badge">World Cup 2026 · powered by TXODDS</span>
        <h1>
          Match<span className="accent">Pot</span>
        </h1>
        <p className="tagline">
          Call the next goal before your friends do. Correct picks pay out points at live
          odds — most points at full time takes the pot.
        </p>
        <div className="hostStrip" aria-label="Hosted across Canada, Mexico and USA">
          <span>🇨🇦 Canada</span>
          <i />
          <span>🇲🇽 Mexico</span>
          <i />
          <span>🇺🇸 USA</span>
        </div>
      </div>

      <div className="card">
        <label className="field">
          <span>Choose a match</span>
          <select
            className="matchSelect"
            value={props.fixtureId}
            onChange={(event) => props.setFixtureId(Number(event.target.value))}
          >
            {DEMO_FIXTURES.map((fixture) => (
              <option key={fixture.id} value={fixture.id}>
                {fixture.home.flag} {fixture.home.name} vs {fixture.away.name}{" "}
                {fixture.away.flag} · {fixtureTimeStatus(fixture, now)}
              </option>
            ))}
          </select>
        </label>

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
          onClick={props.onCreateCompetitive}
          disabled={
            !props.name.trim() ||
            !props.walletConnected ||
            props.chainBusy ||
            props.sessionAction !== null
          }
        >
          {props.sessionAction === "create" ? (
            <span className="btnLoading">
              <span className="loadingSpinner" aria-hidden="true" />
              Creating session…
            </span>
          ) : !props.walletConnected
            ? "Connect wallet to play"
            : selectedFixture.status === "upcoming"
              ? "Create pending session · no deposit yet"
              : "Create a session · 0.1 SOL"}
        </button>

        {selectedFixture.status === "historical" && (
          <>
            <div className="divider">or play instantly</div>
            <button
              className="btn practiceBtn"
              onClick={props.onCreatePractice}
              disabled={!props.name.trim() || props.sessionAction !== null}
            >
              {props.sessionAction === "practice" ? (
                <span className="btnLoading">
                  <span className="loadingSpinner" aria-hidden="true" />
                  Starting practice…
                </span>
              ) : (
                "Practice free vs MatchBot"
              )}
            </button>
            <p className="muted small practiceNote">
              No wallet or SOL required · no prize payout
            </p>
          </>
        )}

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
              props.chainBusy ||
              props.sessionAction !== null
            }
          >
            {props.sessionAction === "join" ? (
              <span className="btnLoading">
                <span className="loadingSpinner" aria-hidden="true" />
                Joining…
              </span>
            ) : (
              "Join"
            )}
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
  depositSignature: string | null;
  chainBusy: boolean;
  startBusy: boolean;
  onDeposit: () => void;
  onStart: () => void;
  error: string | null;
}) {
  const { state, playerId } = props;
  const now = useCurrentTime();
  const [copied, setCopied] = useState(false);
  const [inviteUrl, setInviteUrl] = useState("");
  const isHost = playerId === state.hostId;
  const me = state.players.find((player) => player.id === playerId);
  const deposited = Boolean(me && props.escrow?.depositors.includes(me.wallet));
  const allDeposited =
    state.mode === "practice" ||
    state.players.every((player) => props.escrow?.depositors.includes(player.wallet));
  const waitingForKickoff = Boolean(
    state.fixture.status === "upcoming" &&
      state.fixture.startsAt &&
      now < state.fixture.startsAt,
  );
  const entryOpensAt = fixtureEntryOpensAt(state.fixture);
  const entryOpen = now >= entryOpensAt;
  const waitingForHostEscrow = entryOpen && !isHost && !props.escrow;
  const ready = state.players.length >= 2 && allDeposited && !waitingForKickoff;

  useEffect(() => {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("join", state.code);
    setInviteUrl(url.toString());
  }, [state.code]);

  return (
    <main className="shell">
      <div className="card lobby">
        {state.mode === "practice" ? (
          <>
            <p className="lobbyLabel">Free practice</p>
            <h2>You vs MatchBot</h2>
            <p className="muted">Same predictions and scoring, with no SOL prize.</p>
          </>
        ) : (
          <>
            <p className="lobbyLabel">Session code</p>
            <div className="inviteBlock">
              <InviteQr value={inviteUrl} />
              <div className="inviteDetails">
                <div className="sessionCodeRow">
                  <p className="sessionCode">{state.code}</p>
                  <button
                    className="copyCodeBtn"
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(inviteUrl || state.code).then(() => {
                        setCopied(true);
                        window.setTimeout(() => setCopied(false), 1_500);
                      });
                    }}
                  >
                    {copied ? "Copied ✓" : "Copy invite"}
                  </button>
                </div>
                <p className="muted small">Scan or share the link to prefill this code</p>
              </div>
            </div>
          </>
        )}

        <div className="slots">
          {[0, 1].map((i) => {
            const player = state.players[i];
            return (
              <div key={i} className={`slot ${player ? "filled" : ""}`}>
                {player ? (
                  <>
                    <span className="slotName">{player.name}</span>
                    {player.isBot ? (
                      <span className="hostTag">bot</span>
                    ) : player.id === state.hostId ? (
                      <span className="hostTag">host</span>
                    ) : null}
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

        {state.mode === "competitive" && (
          <>
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
            {(props.depositSignature || props.escrow) && (
              <div className="chainLinks">
                {props.depositSignature && (
                  <ExplorerLink signature={props.depositSignature}>Your deposit ↗</ExplorerLink>
                )}
                {props.escrow && (
                  <a
                    href={solanaAccountUrl(props.escrow.address)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View prize pool ↗
                  </a>
                )}
              </div>
            )}
          </>
        )}

        {state.mode === "competitive" && !deposited && (
          <button
            className="btn"
            onClick={props.onDeposit}
            disabled={props.chainBusy || !entryOpen || waitingForHostEscrow}
          >
            {props.chainBusy ? (
              <span className="btnLoading">
                <span className="loadingSpinner" aria-hidden="true" />
                Confirming on Solana…
              </span>
            ) : !entryOpen
                ? `Deposits open ${formatTimeUntil(entryOpensAt, now)}`
                : waitingForHostEscrow
                  ? "Waiting for host to open prize pool…"
                  : `Deposit ${(ENTRY_LAMPORTS / 1_000_000_000).toFixed(1)} SOL`}
          </button>
        )}

        {isHost ? (
          <button
            className="btn primary"
            onClick={props.onStart}
            disabled={!ready || props.startBusy}
          >
            {props.startBusy ? (
              <span className="btnLoading">
                <span className="loadingSpinner" aria-hidden="true" />
                {state.mode === "practice"
                  ? "Starting replay…"
                  : "Locking prize pool & kicking off…"}
              </span>
            ) : ready
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

        {state.feedError && <p className="error">TXODDS feed: {state.feedError}</p>}
        {props.error && <p className="error">{props.error}</p>}
      </div>
    </main>
  );
}

function useCurrentTime(): number {
  // Keep the server render and first browser render identical; populate the
  // real clock only after hydration.
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
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

function fixtureTimeStatus(fixture: GameFixture, now: number): "PAST" | "PRESENT" | "FUTURE" {
  if (fixture.status === "historical") return "PAST";
  if (fixture.startsAt && now >= fixture.startsAt) return "PRESENT";
  return "FUTURE";
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

function MatchScreen(props: {
  state: SessionState;
  playerId: string;
  escrow: EscrowSnapshot | null;
  onPredict: (team: TeamCode) => void;
  onPlayAgain: () => void;
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
  const notifiedQuestion = useRef<string | null>(null);
  const latestGoal = [...state.feed].reverse().find((event) => event.kind === "GOAL");
  const latestGoalKey =
    latestGoal?.kind === "GOAL"
      ? `${latestGoal.minute}-${latestGoal.team}-${latestGoal.scorer}`
      : null;
  const seenGoal = useRef(latestGoalKey);
  const [goalFlash, setGoalFlash] = useState<string | null>(null);
  const previousOdds = useRef({ ...state.odds });
  const [oddsMovement, setOddsMovement] = useState<Record<TeamCode, -1 | 0 | 1>>({
    HOME: 0,
    AWAY: 0,
  });
  const previousScores = useRef(
    Object.fromEntries(state.players.map((player) => [player.id, player.score])),
  );
  const [scoreBumps, setScoreBumps] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!latestGoal || latestGoal.kind !== "GOAL" || !latestGoalKey) return;
    if (seenGoal.current === latestGoalKey) return;
    seenGoal.current = latestGoalKey;
    setGoalFlash(`${team(latestGoal.team).flag} GOAL! ${team(latestGoal.team).name}`);
    const timer = window.setTimeout(() => setGoalFlash(null), 1_800);
    return () => window.clearTimeout(timer);
  }, [latestGoalKey]);

  useEffect(() => {
    const movement = Object.fromEntries(
      TEAM_CODES.map((code) => [
        code,
        state.odds[code] === previousOdds.current[code]
          ? 0
          : state.odds[code] > previousOdds.current[code]
            ? 1
            : -1,
      ]),
    ) as Record<TeamCode, -1 | 0 | 1>;
    previousOdds.current = { ...state.odds };
    setOddsMovement(movement);
    if (!TEAM_CODES.some((code) => movement[code] !== 0)) return;
    const timer = window.setTimeout(
      () => setOddsMovement({ HOME: 0, AWAY: 0 }),
      1_800,
    );
    return () => window.clearTimeout(timer);
  }, [state.odds.AWAY, state.odds.HOME]);

  useEffect(() => {
    const changed = state.players
      .filter((player) => player.score > (previousScores.current[player.id] ?? 0))
      .map((player) => player.id);
    previousScores.current = Object.fromEntries(
      state.players.map((player) => [player.id, player.score]),
    );
    if (changed.length === 0) return;
    setScoreBumps(new Set(changed));
    const timer = window.setTimeout(() => setScoreBumps(new Set()), 900);
    return () => window.clearTimeout(timer);
  }, [state.players]);

  useEffect(() => {
    if (!question || notifiedQuestion.current === question.id) return;
    notifiedQuestion.current = question.id;
    navigator.vibrate?.(80);
    try {
      const audio = new AudioContext();
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(660, audio.currentTime);
      gain.gain.setValueAtTime(0.0001, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, audio.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.18);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + 0.2);
      oscillator.addEventListener("ended", () => void audio.close());
    } catch {
      // Browsers may block audio until the page has received a user gesture;
      // the visual pop animation and vibration remain as fallbacks.
    }
  }, [question]);

  return (
    <main className="shell wide">
      {goalFlash && <div className="goalFlash">{goalFlash}</div>}
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

      <div className="card oddsCard matchOddsBar">
        <div className="oddsTitleRow">
          <p className="cardTitle">Next goal odds</p>
          <span className="liveBadge"><i /> TXODDS LIVE</span>
        </div>
        <div className="oddsTicker">
          {TEAM_CODES.map((code) => (
            <div key={code}>
              <span>{team(code).flag} {team(code).name}</span>
              <strong className={oddsMovement[code] > 0 ? "oddsUp" : oddsMovement[code] < 0 ? "oddsDown" : ""}>
                {state.odds[code].toFixed(2)}× {oddsMovement[code] > 0 ? "↑" : oddsMovement[code] < 0 ? "↓" : ""}
              </strong>
            </div>
          ))}
        </div>
      </div>

      <div className="columns">
        <section className="mainCol">
          {state.status === "finished" ? (
            <FinalCard
              state={state}
              playerId={playerId}
              escrow={props.escrow}
              onPlayAgain={props.onPlayAgain}
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
                          ? `${state.odds[code].toFixed(2)}× · pays ${Math.round(100 * state.odds[code])} pts`
                          : "pays 150 pts"}
                        {question.type === "NEXT_GOAL" && oddsMovement[code] !== 0 && (
                          <span className={oddsMovement[code] > 0 ? "oddsUp" : "oddsDown"}>
                            {oddsMovement[code] > 0 ? " ↑" : " ↓"}
                          </span>
                        )}
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
                            {entry.points > 0
                              ? state.lastResult?.type === "NEXT_GOAL"
                                ? `${entry.oddsAtPick.toFixed(2)}× × 100 = +${entry.points} pts`
                                : `flat pick = +${entry.points} pts`
                              : "+0 pts"}
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
                  <li
                    key={p.id}
                    className={`${p.id === playerId ? "me" : ""} ${scoreBumps.has(p.id) ? "scoreBump" : ""}`}
                  >
                    <span>
                      {p.name}
                      {p.id === playerId && " (you)"}
                      {!p.connected && " ⚠︎"}
                    </span>
                    <span className="pts">{p.score}</span>
                  </li>
                ))}
            </ul>
            {me && (
              <p className="muted small">
                {state.mode === "practice"
                  ? "Practice scoring uses the same TXODDS-powered odds."
                  : "Points pay out at TXODDS live odds."}
              </p>
            )}
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
  onPlayAgain,
}: {
  state: SessionState;
  playerId: string;
  escrow: EscrowSnapshot | null;
  onPlayAgain: () => void;
}) {
  const winners = state.winners ?? [];
  const winnerNames = state.players
    .filter((p) => winners.includes(p.id))
    .map((p) => p.name);
  const iWon = winners.includes(playerId);
  const tie = winners.length > 1;
  const noContest = state.noContest;
  const practice = state.mode === "practice";
  const settled = state.results.filter((r) => r.team !== null);
  const correctCount = (pid: string) =>
    settled.filter((r) => r.entries.some((e) => e.playerId === pid && e.points > 0)).length;
  const winningMoments = settled.filter((result) =>
    result.entries.some((entry) => winners.includes(entry.playerId) && entry.points > 0),
  );
  const poolSol = formatSol(ENTRY_LAMPORTS * state.players.length);

  return (
    <div className="card finalCard">
      {!noContest && <Confetti />}
      <p className="trophy">{practice ? "🎮" : "🏆"}</p>
      <h2>
        {practice && noContest
          ? "Practice draw — no points"
          : practice
            ? tie
              ? `It's a draw: ${winnerNames.join(" & ")}`
              : `${winnerNames[0]} wins!`
            : noContest
              ? "No points — entries refunded"
              : tie
                ? `It's a tie: ${winnerNames.join(" & ")}`
                : `${winnerNames[0]} wins the pot!`}
      </h2>
      <p className="muted">
        {practice
          ? "Practice complete — no SOL was deposited or paid out."
          : noContest
            ? "Nobody scored, so every player receives their original SOL entry back."
            : iWon && !tie
              ? "The SOL prize pot is yours."
              : tie
                ? "Pot splits down the middle."
                : "Better luck next match."}
      </p>
      <ul className="scoreList final">
        {[...state.players]
          .sort((a, b) => b.score - a.score)
          .map((p) => (
            <li key={p.id} className={!noContest && winners.includes(p.id) ? "me" : ""}>
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

      {winningMoments.length > 0 && (
        <div className="winningMoments">
          <p className="cardTitle">Winning predictions</p>
          {winningMoments.slice(-3).map((result) => {
            const winningEntry = result.entries.find(
              (entry) => winners.includes(entry.playerId) && entry.points > 0,
            );
            if (!winningEntry) return null;
            return (
              <div key={result.questionId}>
                <span>{result.headline}</span>
                <strong>
                  {result.type === "NEXT_GOAL"
                    ? `${winningEntry.oddsAtPick.toFixed(2)}× → +${winningEntry.points}`
                    : `+${winningEntry.points} pts`}
                </strong>
              </div>
            );
          })}
        </div>
      )}

      {practice ? (
        <p className="muted small">Free practice game · no SOL prize</p>
      ) : (
        <div className={`settlementReceipt ${state.payoutSignature ? "settled" : "settling"}`}>
          <div className="receiptHeader">
            <span>Solana settlement receipt</span>
            <strong>{state.payoutSignature ? "✓ SETTLED" : "● SETTLING"}</strong>
          </div>
          <div className="receiptRow">
            <span>Fixture</span>
            <strong>{state.fixture.home.name} vs {state.fixture.away.name}</strong>
          </div>
          <div className="receiptRow">
            <span>{noContest ? "Refunded to" : tie ? "Split between" : "Winner"}</span>
            <strong>{noContest ? "All players" : winnerNames.join(" & ")}</strong>
          </div>
          <div className="receiptRow">
            <span>{noContest ? "Total refunded" : "Prize pool"}</span>
            <strong>{poolSol} SOL</strong>
          </div>
          <div className="receiptRow">
            <span>Settlement</span>
            <strong>Automatic · MatchPot application</strong>
          </div>
          {state.payoutSignature ? (
            <ExplorerLink signature={state.payoutSignature}>
              {noContest ? "View automatic refund ↗" : "View automatic payout ↗"}
            </ExplorerLink>
          ) : (
            <p className="receiptPending">
              <span className="loadingSpinner" aria-hidden="true" />
              {noContest ? "Returning every entry…" : "Paying the winner automatically…"}
              {escrow ? ` ${formatSol(escrow.prizePoolLamports)} SOL locked.` : ""}
            </p>
          )}
        </div>
      )}
      <button className="btn primary playAgainBtn" onClick={onPlayAgain}>
        Play another match
      </button>
    </div>
  );
}

function InviteQr({ value }: { value: string }) {
  const [image, setImage] = useState("");

  useEffect(() => {
    let active = true;
    if (!value) return;
    void QRCode.toDataURL(value, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 160,
      color: { dark: "#07140fff", light: "#ffffffff" },
    })
      .then((url) => active && setImage(url))
      .catch(() => active && setImage(""));
    return () => {
      active = false;
    };
  }, [value]);

  return image ? (
    <img className="inviteQr" src={image} alt="Scan to join this MatchPot session" />
  ) : (
    <div className="inviteQr qrLoading" aria-label="Preparing invite QR code" />
  );
}

function ExplorerLink({ signature, children }: { signature: string; children: ReactNode }) {
  return (
    <a
      className="explorerLink"
      href={solanaTransactionUrl(signature)}
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  );
}

function Confetti() {
  return (
    <div className="confetti" aria-hidden="true">
      {Array.from({ length: 24 }, (_, index) => (
        <i
          key={index}
          style={{ "--confetti-index": index } as CSSProperties}
        />
      ))}
    </div>
  );
}

function solanaTransactionUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=devnet`;
}

function solanaAccountUrl(address: string): string {
  return `https://explorer.solana.com/address/${encodeURIComponent(address)}?cluster=devnet`;
}

function formatSol(lamports: number): string {
  return (lamports / 1_000_000_000).toFixed(2);
}
