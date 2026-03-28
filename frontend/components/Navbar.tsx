import Link from "next/link";
import { HeadStatusBadge } from "./HeadStatusBadge";
import { WalletConnect } from "./WalletConnect";

export function Navbar() {
  return (
    <nav className="border-b border-gray-800 bg-gray-900">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-lg font-bold text-hydra-500 hover:text-hydra-400">
          ⚡ Hydra Marketplace
        </Link>
        <div className="flex items-center gap-6">
          <Link href="/" className="text-sm text-gray-300 hover:text-white">
            Browse
          </Link>
          <Link href="/identity" className="text-sm text-gray-300 hover:text-white">
            Identidad
          </Link>
          <Link href="/sell" className="text-sm text-gray-300 hover:text-white">
            Vender
          </Link>
          <Link href="/status" className="text-sm text-gray-300 hover:text-white">
            Status
          </Link>
          <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-300">
            Admin
          </Link>
          <HeadStatusBadge />
          <WalletConnect />
        </div>
      </div>
    </nav>
  );
}
