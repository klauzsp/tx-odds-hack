import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Barlow, Barlow_Condensed } from "next/font/google";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./globals.css";
import SolanaWalletProvider from "../components/SolanaWalletProvider";
import WalletHeader from "../components/WalletHeader";

const bodyFont = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

const displayFont = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MatchPot — live prediction battles",
  description:
    "Predict the next goal with your friends during live World Cup matches, powered by TXODDS.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${bodyFont.variable} ${displayFont.variable}`}>
        <SolanaWalletProvider>
          <WalletHeader />
          {children}
        </SolanaWalletProvider>
      </body>
    </html>
  );
}
