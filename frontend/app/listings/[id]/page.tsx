import { api, lovelaceToAda, shortHex } from "@/lib/api";
import { notFound } from "next/navigation";
import { BuySection } from "./BuySection";
import { CancelSection } from "./CancelSection";

export const revalidate = 3;

export default async function ListingPage({ params }: { params: { id: string } }) {
  let listing;
  try {
    listing = await api.listing(params.id);
  } catch {
    notFound();
  }

  const name = listing.displayName ?? shortHex(listing.unit, 8);

  const statusColor: Record<string, string> = {
    active:    "text-green-400",
    draft:     "text-yellow-400",
    sold:      "text-blue-400",
    cancelled: "text-gray-400",
    failed:    "text-red-400",
  };

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
        {/* Image */}
        <div className="flex h-64 items-center justify-center bg-gray-800 text-6xl">
          {listing.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={listing.imageUrl} alt={name} className="h-full w-full object-cover" />
          ) : "🖼️"}
        </div>

        <div className="p-6">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">{name}</h1>
              <p className="mt-1 text-sm text-gray-400">
                Policy: <span className="font-mono text-gray-300">{shortHex(listing.policyId, 8)}</span>
              </p>
            </div>
            <span className={`text-sm font-medium ${statusColor[listing.status] ?? "text-gray-400"}`}>
              {listing.status.toUpperCase()}
            </span>
          </div>

          {/* Price */}
          <div className="mt-6 flex items-center gap-2">
            <span className="text-3xl font-bold text-white">{lovelaceToAda(listing.priceLovelace)}</span>
            <span className="text-lg text-gray-400">ADA</span>
          </div>

          {/* Details */}
          <dl className="mt-6 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-gray-500">Seller</dt>
              <dd className="font-mono text-gray-300 break-all">{shortHex(listing.sellerAddress, 10)}</dd>
            </div>
            {listing.escrowTxHash && (
              <div>
                <dt className="text-gray-500">Escrow TX</dt>
                <dd className="font-mono text-gray-300">{shortHex(listing.escrowTxHash, 8)}</dd>
              </div>
            )}
            <div>
              <dt className="text-gray-500">Listed</dt>
              <dd className="text-gray-300">{new Date(listing.createdAt).toLocaleString()}</dd>
            </div>
            {listing.sale && (
              <div>
                <dt className="text-gray-500">Buyer</dt>
                <dd className="font-mono text-gray-300">{shortHex(listing.sale.buyerAddress, 10)}</dd>
              </div>
            )}
          </dl>

          {/* Sale confirmation */}
          {listing.sale?.status === "confirmed" && (
            <div className="mt-6 rounded-lg border border-blue-800 bg-blue-950 p-3 text-sm text-blue-300">
              ✓ Sold — TX: <span className="font-mono">{shortHex(listing.sale.hydraTxId ?? "", 8)}</span>
              {listing.sale.confirmedAt && (
                <span className="ml-2 text-blue-400">
                  at {new Date(listing.sale.confirmedAt).toLocaleString()}
                </span>
              )}
            </div>
          )}

          {/* Actions */}
          {listing.status === "active" && (
            <div className="mt-6 space-y-3">
              <BuySection listingId={listing.id} priceLovelace={listing.priceLovelace} displayName={listing.displayName} />
              <CancelSection listingId={listing.id} sellerAddress={listing.sellerAddress} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
