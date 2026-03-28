import { api, type Listing } from "@/lib/api";
import { ListingCard } from "@/components/ListingCard";
import Link from "next/link";

export const revalidate = 5; // refresh every 5s

export default async function HomePage() {
  let listings: Listing[] = [];
  let total = 0;
  let headError = false;

  try {
    const data = await api.listings({ status: "active", limit: 50 });
    listings = data.listings;
    total = data.total;
  } catch {
    headError = true;
  }

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Active Listings</h1>
          {!headError && (
            <p className="mt-1 text-sm text-gray-400">{total} NFT{total !== 1 ? "s" : ""} for sale</p>
          )}
        </div>
        <Link
          href="/sell"
          className="rounded-lg bg-hydra-600 px-4 py-2 text-sm font-medium text-white hover:bg-hydra-500 transition-colors"
        >
          + List NFT
        </Link>
      </div>

      {headError && (
        <div className="rounded-lg border border-red-800 bg-red-950 p-4 text-sm text-red-300">
          ⚠ Cannot connect to backend API. Make sure the backend is running on port 3000.
        </div>
      )}

      {!headError && listings.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-gray-800 bg-gray-900 py-24 text-center">
          <p className="text-4xl">🖼️</p>
          <p className="mt-4 text-lg font-semibold text-white">No active listings</p>
          <p className="mt-1 text-sm text-gray-400">Be the first to list an NFT</p>
          <Link
            href="/sell"
            className="mt-6 rounded-lg bg-hydra-600 px-4 py-2 text-sm font-medium text-white hover:bg-hydra-500"
          >
            List an NFT
          </Link>
        </div>
      )}

      {listings.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {listings.map((l) => (
            <ListingCard key={l.id} listing={l} />
          ))}
        </div>
      )}
    </div>
  );
}
