"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ListingCard } from "./ListingCard";
import type { Listing } from "@/lib/api";

interface Props {
  initialListings: Listing[];
  initialTotal:    number;
}

export function ListingsGrid({ initialListings, initialTotal }: Props) {
  const [listings, setListings] = useState<Listing[]>(initialListings);
  const [total,    setTotal]    = useState(initialTotal);
  const [pulse,    setPulse]    = useState(false); // brief flash on update

  const refresh = useCallback(async () => {
    try {
      const res  = await fetch("/api/listings?status=active&limit=50");
      const data = await res.json() as { listings: Listing[]; total: number };
      setListings(data.listings);
      setTotal(data.total);
      setPulse(true);
      setTimeout(() => setPulse(false), 800);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const es = new EventSource("/api/events");

    es.addEventListener("message", (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data as string) as { type: string };
        // Refresh listing grid when a trade or snapshot is confirmed
        if (msg.type === "SnapshotConfirmed" || msg.type === "TxValid") {
          void refresh();
        }
      } catch { /* ignore malformed */ }
    });

    es.onerror = () => {
      // SSE disconnected — will auto-reconnect via browser
    };

    return () => es.close();
  }, [refresh]);

  return (
    <>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Publicaciones activas</h1>
          <p className={`mt-1 text-sm transition-colors ${pulse ? "text-hydra-400" : "text-gray-400"}`}>
            {total} cultivo{total !== 1 ? "s" : ""} en venta
          </p>
        </div>
        <Link href="/sell"
          className="rounded-lg bg-hydra-600 px-4 py-2 text-sm font-medium text-white hover:bg-hydra-500 transition-colors">
          + Publicar cultivo
        </Link>
      </div>

      {listings.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-gray-800 bg-gray-900 py-24 text-center">
          <p className="text-4xl">🌾</p>
          <p className="mt-4 text-lg font-semibold text-white">Sin publicaciones activas</p>
          <p className="mt-1 text-sm text-gray-400">Sé el primero en publicar un cultivo</p>
          <Link href="/sell"
            className="mt-6 rounded-lg bg-hydra-600 px-4 py-2 text-sm font-medium text-white hover:bg-hydra-500">
            Publicar cultivo
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
    </>
  );
}
