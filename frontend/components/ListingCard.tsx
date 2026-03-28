import Link from "next/link";
import type { Listing } from "@/lib/api";
import { lovelaceToAda, shortHex } from "@/lib/api";

const statusBadge: Record<string, string> = {
  active:    "bg-green-900 text-green-300",
  draft:     "bg-yellow-900 text-yellow-300",
  sold:      "bg-blue-900 text-blue-300",
  cancelled: "bg-gray-800 text-gray-400",
  failed:    "bg-red-900 text-red-300",
};

export function ListingCard({ listing }: { listing: Listing }) {
  const name = listing.displayName ?? shortHex(listing.unit, 6);
  const badge = statusBadge[listing.status] ?? "bg-gray-800 text-gray-400";

  return (
    <Link href={`/listings/${listing.id}`}>
      <div className="group flex flex-col rounded-xl border border-gray-800 bg-gray-900 p-4 hover:border-hydra-500 transition-colors cursor-pointer">
        {/* NFT image placeholder */}
        <div className="mb-3 flex h-40 items-center justify-center rounded-lg bg-gray-800 text-4xl">
          {listing.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={listing.imageUrl} alt={name} className="h-full w-full rounded-lg object-cover" />
          ) : (
            "🖼️"
          )}
        </div>

        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold text-white group-hover:text-hydra-400">{name}</p>
            <p className="mt-0.5 text-xs text-gray-500">{shortHex(listing.sellerAddress, 6)}</p>
          </div>
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${badge}`}>
            {listing.status}
          </span>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <span className="text-lg font-bold text-white">
            {lovelaceToAda(listing.priceLovelace)} <span className="text-sm text-gray-400">ADA</span>
          </span>
          {listing.status === "active" && (
            <span className="rounded-lg bg-hydra-600 px-3 py-1 text-sm font-medium text-white group-hover:bg-hydra-500">
              Buy
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
