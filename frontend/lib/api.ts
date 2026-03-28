// Typed API client — calls Next.js rewrites → backend at localhost:3000

export interface Listing {
  id:            string;
  sellerAddress: string;
  policyId:      string;
  assetName:     string;
  unit:          string;
  displayName:   string | null;
  imageUrl:      string | null;
  priceLovelace: string;
  status:        "draft" | "active" | "sold" | "cancelled" | "failed";
  escrowTxHash:  string | null;
  escrowUtxoIx:  number | null;
  createdAt:     string;
  updatedAt:     string;
  sale?: Sale | null;
}

export interface Sale {
  id:           string;
  buyerAddress: string;
  hydraTxId:    string | null;
  status:       "pending" | "confirmed" | "failed";
  confirmedAt:  string | null;
}

export interface HeadStatus {
  sessionId:              string | null;
  status:                 string;
  network:                string;
  contestationPeriodSecs: number;
  openedAt:               string | null;
  closedAt:               string | null;
  contestationDeadline:   string | null;
}

export interface HealthStatus {
  ok:         boolean;
  uptime:     number;
  startedAt:  string;
  db:         "ok" | "error";
  hydra:      "connected" | "disconnected";
  headStatus: string;
  headOpen:   boolean;
}

export interface FarmerRegistration {
  id:               string;
  walletAddress:    string;
  companyName:      string;
  status:           "pending" | "approved" | "rejected";
  farmerPassTxHash: string | null;
  createdAt:        string;
}

export interface CropMint {
  id:            string;
  cropName:      string;
  assetNameHex:  string;
  quantity:      number;
  priceLovelace: string;
  txHash:        string | null;
  status:        string;
  confirmedAt:   string | null;
  createdAt:     string;
}

export interface ListingsResponse {
  listings: Listing[];
  total:    number;
  limit:    number;
  offset:   number;
}

// In server components, relative URLs don't work — use absolute URL to backend directly.
// In client components, Next.js rewrites /api/* → backend, so relative URL works.
const IS_SERVER = typeof window === "undefined";
const BASE = IS_SERVER
  ? `http://127.0.0.1:${process.env.BACKEND_PORT ?? "3000"}/api`
  : "/api";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "unknown" })) as { error: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  const data = await res.json() as T & { error?: string };
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data;
}

export const api = {
  health: () =>
    get<HealthStatus>("/health"),

  headStatus: () =>
    get<HeadStatus>("/head/status"),

  listings: (params?: { status?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.limit  !== undefined) q.set("limit",  String(params.limit));
    if (params?.offset !== undefined) q.set("offset", String(params.offset));
    const qs = q.toString();
    return get<ListingsResponse>(`/listings${qs ? "?" + qs : ""}`);
  },

  listing: (id: string) =>
    get<Listing>(`/listings/${id}`),

  createListing: (body: {
    requestId:     string;
    sellerAddress: string;
    policyId:      string;
    assetName:     string;
    priceLovelace: string;
  }) => post<{ listingId: string; status: string; escrowTxCbor: string; txId: string; message: string }>("/listings", body),

  escrowConfirm: (id: string, body: { signedTxCbor: string; txId: string }) =>
    post<{ submissionId: string; status: string }>(`/listings/${id}/escrow-confirm`, body),

  buy: (id: string, body: { requestId: string; buyerAddress: string }) =>
    post<{ saleId: string; submissionId: string; hydraTxId: string; status: string; message: string }>(
      `/listings/${id}/buy`, body
    ),

  cancelTx: (id: string) =>
    get<{ unsignedTxCbor: string; txId: string }>(`/listings/${id}/cancel-tx`),

  cancel: (id: string, body: { requestId: string; sellerAddress: string; signedCancelTxCbor: string; txId: string }) =>
    post<{ submissionId: string; status: string }>(`/listings/${id}/cancel`, body),

  farmerStatus: (address: string) =>
    get<FarmerRegistration>(`/farmers/status/${address}`),

  farmerRegister: (body: { walletAddress: string; companyName: string; identityHash: string }) =>
    post<FarmerRegistration>("/farmers/register", body),

  cropMint: (body: { farmerAddress: string; cropName: string; assetNameHex: string; quantity: number; priceLovelace: number }) =>
    post<CropMint>("/crops/mint", body),

  cropList: (address: string) =>
    get<CropMint[]>(`/crops/${address}`),
};

// Format lovelace as ADA string
export function lovelaceToAda(lovelace: string | number): string {
  return (Number(lovelace) / 1_000_000).toFixed(2);
}

// Short hex for display
export function shortHex(hex: string, chars = 8): string {
  if (hex.length <= chars * 2) return hex;
  return `${hex.slice(0, chars)}…${hex.slice(-4)}`;
}

// Random UUIDv4 (client-side)
export function newRequestId(): string {
  return crypto.randomUUID();
}
