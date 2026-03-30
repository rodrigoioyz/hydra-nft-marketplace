import { api, type Listing } from "@/lib/api";
import { ListingsGrid } from "@/components/ListingsGrid";

export const revalidate = 60; // fallback for non-SSE clients

export default async function HomePage() {
  let listings: Listing[] = [];
  let total    = 0;

  try {
    const data = await api.listings({ status: "active", limit: 50 });
    listings   = data.listings;
    total      = data.total;
  } catch { /* backend unreachable on first render */ }

  return <ListingsGrid initialListings={listings} initialTotal={total} />;
}
