// T5.5 — Listing repository: all DB queries for the listings table

import type { Pool } from "pg";

export interface ListingRow {
  id:               string;
  seller_address:   string;
  policy_id:        string;
  asset_name:       string;
  unit:             string;
  price_lovelace:   string;   // pg returns bigint as string
  status:           string;
  escrow_tx_hash:   string | null;
  escrow_utxo_ix:   number | null;
  head_session_id:  string;
  created_at:       Date;
  updated_at:       Date;
}

export interface CreateListingOpts {
  sellerAddress:  string;
  policyId:       string;
  assetName:      string;
  priceLovelace:  bigint;
  headSessionId:  string;
}

export class ListingRepo {
  constructor(private readonly pool: Pool) {}

  async create(opts: CreateListingOpts): Promise<ListingRow> {
    const { rows } = await this.pool.query<ListingRow>(
      `INSERT INTO listings
         (seller_address, policy_id, asset_name, price_lovelace, head_session_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [opts.sellerAddress, opts.policyId, opts.assetName, opts.priceLovelace.toString(), opts.headSessionId]
    );
    return rows[0]!;
  }

  async findById(id: string): Promise<ListingRow | null> {
    const { rows } = await this.pool.query<ListingRow>(
      `SELECT * FROM listings WHERE id = $1`,
      [id]
    );
    return rows[0] ?? null;
  }

  async findActiveByUnit(unit: string): Promise<ListingRow | null> {
    const { rows } = await this.pool.query<ListingRow>(
      `SELECT * FROM listings WHERE unit = $1 AND status = 'active'`,
      [unit]
    );
    return rows[0] ?? null;
  }

  async findByUnit(unit: string): Promise<ListingRow | null> {
    const { rows } = await this.pool.query<ListingRow>(
      `SELECT * FROM listings WHERE unit = $1 AND status IN ('draft','active') ORDER BY created_at DESC LIMIT 1`,
      [unit]
    );
    return rows[0] ?? null;
  }

  async list(opts: {
    status?: string;
    seller?: string;
    limit:   number;
    offset:  number;
  }): Promise<{ rows: ListingRow[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let p = 1;

    if (opts.status) { conditions.push(`status = $${p++}`); params.push(opts.status); }
    if (opts.seller) { conditions.push(`seller_address = $${p++}`); params.push(opts.seller); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const [dataRes, countRes] = await Promise.all([
      this.pool.query<ListingRow>(
        `SELECT * FROM listings ${where} ORDER BY created_at DESC LIMIT $${p++} OFFSET $${p++}`,
        [...params, opts.limit, opts.offset]
      ),
      this.pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM listings ${where}`,
        params
      ),
    ]);

    return {
      rows:  dataRes.rows,
      total: Number(countRes.rows[0]!.count),
    };
  }

  async setEscrow(id: string, txHash: string, utxoIx: number): Promise<void> {
    await this.pool.query(
      `UPDATE listings SET escrow_tx_hash = $1, escrow_utxo_ix = $2, status = 'active' WHERE id = $3`,
      [txHash, utxoIx, id]
    );
  }

  async setStatus(id: string, status: string): Promise<void> {
    await this.pool.query(
      `UPDATE listings SET status = $1 WHERE id = $2`,
      [status, id]
    );
  }
}
