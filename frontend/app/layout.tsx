import type { Metadata } from "next";
import "./globals.css";
import { Navbar } from "@/components/Navbar";
import { WalletProvider } from "@/context/WalletContext";

export const metadata: Metadata = {
  title: "Hydra NFT Marketplace",
  description: "Fixed-price NFT marketplace on Cardano Hydra",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          <Navbar />
          <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        </WalletProvider>
      </body>
    </html>
  );
}
