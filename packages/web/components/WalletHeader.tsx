"use client";

import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import MatchPotLogo from "./MatchPotLogo";

export default function WalletHeader() {
  return (
    <header className="walletHeader">
      <a className="brand" href="/" aria-label="MatchPot home">
        <MatchPotLogo size="nav" />
        <span className="brandWord">
          Match<em>Pot</em>
        </span>
        <span className="brandTournament">World Cup 26</span>
      </a>
      <div className="walletControls">
        <WalletMultiButton />
      </div>
    </header>
  );
}
