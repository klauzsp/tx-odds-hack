import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./globals.css";
import SolanaWalletProvider from "../components/SolanaWalletProvider";
import WalletHeader from "../components/WalletHeader";

export const metadata: Metadata = {
  title: "MatchPot — live prediction battles",
  description:
    "Predict the next goal with your friends during live World Cup matches, powered by TXODDS.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SolanaWalletProvider>
          <WalletHeader />
          {children}
        </SolanaWalletProvider>
      </body>
    </html>
  );
}
