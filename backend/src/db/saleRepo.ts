// Sale repository — CRUD for the sales table

import type { Pool } from "pg";

export interface SaleRow {
  id:             string;
  listing_id:     string;
  buyer_address:  string;
  seller_address: string;
  unit:           string;
  price_lovelace: string;
  hydra_tx_id:    string | null;
  status:         string;
  created_at:     Date;
  confirmed_at:   Date | null;
}

export class SaleRepo {
  constructor(private readonly pool: Pool) {}

  async create(opts: {
    listingId:     string;
    buyerAddress:  string;
    sellerAddress: string;
    unit:          string;
    priceLovelace: bigint;
  }): Promise<SaleRow> {
    const { rows } = await this.pool.query<SaleRow>(
      `INSERT INTO sales (listing_id, buyer_address, seller_address, unit, price_lovelace)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [opts.listingId, opts.buyerAddress, opts.sellerAddress, opts.unit, opts.priceLovelace.toString()]
    );
    return rows[0]!;
  }

  async findPendingByListing(listingId: string): Promise<SaleRow | null> {
    const { rows } = await this.pool.query<SaleRow>(
      `SELECT * FROM sales WHERE listing_id = $1 AND status = 'pending'`,
      [listingId]
    );
    return rows[0] ?? null;
  }

  async confirm(saleId: string, hydraTxId: string): Promise<void> {
    await this.pool.query(
      `UPDATE sales SET status = 'confirmed', hydra_tx_id = $1, confirmed_at = now() WHERE id = $2`,
      [hydraTxId, saleId]
    );
  }

  async fail(saleId: string): Promise<void> {
    await this.pool.query(
      `UPDATE sales SET status = 'failed' WHERE id = $1`,
      [saleId]
    );
  }
}
