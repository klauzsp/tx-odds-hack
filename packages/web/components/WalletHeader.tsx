"use client";

import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export default function WalletHeader() {
  return (
    <header className="walletHeader">
      <a className="brand" href="/" aria-label="MatchPot home">
        <span className="brandBall" aria-hidden="true">⚽</span>
        <span className="brandWord">
          Match<em>Pot</em>
        </span>
        <span className="brandTournament">World Cup 26</span>
      </a>
      <div className="walletControls">
        <span className="networkBadge">Solana devnet</span>
        <WalletMultiButton />
      </div>
    </header>
  );
}
