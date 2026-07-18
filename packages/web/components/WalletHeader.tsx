"use client";

import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export default function WalletHeader() {
  return (
    <header className="walletHeader">
      <a className="brand" href="/" aria-label="NextGoal home">
        Next<span>Goal</span>
      </a>
      <div className="walletControls">
        <span className="networkBadge">Solana devnet</span>
        <WalletMultiButton />
      </div>
    </header>
  );
}
