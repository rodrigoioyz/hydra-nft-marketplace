import type { Pool } from "pg";

export type FarmerStatus = "pending" | "approved" | "rejected";

export interface FarmerRow {
  id: string;
  wallet_address: string;
  company_name: string;
  identity_hash: string;
  status: FarmerStatus;
  farmer_pass_tx_hash: string | null;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  rejection_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CropMintRow {
  id: string;
  farmer_address: string;
  crop_name: string;
  asset_name_hex: string;
  quantity: string;
  price_lovelace: string;
  tx_hash: string | null;
  status: string;
  error_message: string | null;
  created_at: Date;
  confirmed_at: Date | null;
}

export class FarmerRepo {
  constructor(private pool: Pool) {}

  async upsertRegistration(params: {
    walletAddress: string;
    companyName: string;
    identityHash: string;
  }): Promise<FarmerRow> {
    const { rows } = await this.pool.query<FarmerRow>(
      `INSERT INTO farmer_registrations (wallet_address, company_name, identity_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (wallet_address) DO UPDATE
         SET company_name   = EXCLUDED.company_name,
             identity_hash  = EXCLUDED.identity_hash,
             status         = 'pending',
             updated_at     = now()
       RETURNING *`,
      [params.walletAddress, params.companyName, params.identityHash]
    );
    return rows[0];
  }

  async findById(id: string): Promise<FarmerRow | null> {
    const { rows } = await this.pool.query<FarmerRow>(
      "SELECT * FROM farmer_registrations WHERE id = $1",
      [id]
    );
    return rows[0] ?? null;
  }

  async findByAddress(walletAddress: string): Promise<FarmerRow | null> {
    const { rows } = await this.pool.query<FarmerRow>(
      "SELECT * FROM farmer_registrations WHERE wallet_address = $1",
      [walletAddress]
    );
    return rows[0] ?? null;
  }

  async listByStatus(status: FarmerStatus): Promise<FarmerRow[]> {
    const { rows } = await this.pool.query<FarmerRow>(
      "SELECT * FROM farmer_registrations WHERE status = $1 ORDER BY created_at ASC",
      [status]
    );
    return rows;
  }

  async approve(id: string, reviewerAddress: string, passTxHash: string): Promise<FarmerRow | null> {
    const { rows } = await this.pool.query<FarmerRow>(
      `UPDATE farmer_registrations
       SET status = 'approved',
           reviewed_by = $2,
           reviewed_at = now(),
           farmer_pass_tx_hash = $3
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [id, reviewerAddress, passTxHash]
    );
    return rows[0] ?? null;
  }

  async reject(id: string, reviewerAddress: string, reason: string): Promise<FarmerRow | null> {
    const { rows } = await this.pool.query<FarmerRow>(
      `UPDATE farmer_registrations
       SET status = 'rejected',
           reviewed_by = $2,
           reviewed_at = now(),
           rejection_reason = $3
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [id, reviewerAddress, reason]
    );
    return rows[0] ?? null;
  }

  // ── Crop mints ──────────────────────────────────────────────────────────────

  async createCropMint(params: {
    farmerAddress: string;
    cropName: string;
    assetNameHex: string;
    quantity: number;
    priceLovelace: number;
  }): Promise<CropMintRow> {
    const { rows } = await this.pool.query<CropMintRow>(
      `INSERT INTO crop_mints (farmer_address, crop_name, asset_name_hex, quantity, price_lovelace)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [params.farmerAddress, params.cropName, params.assetNameHex, params.quantity, params.priceLovelace]
    );
    return rows[0];
  }

  async confirmCropMint(id: string, txHash: string): Promise<CropMintRow | null> {
    const { rows } = await this.pool.query<CropMintRow>(
      `UPDATE crop_mints
       SET tx_hash = $2, status = 'confirmed', confirmed_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, txHash]
    );
    return rows[0] ?? null;
  }

  async listCropMints(farmerAddress: string): Promise<CropMintRow[]> {
    const { rows } = await this.pool.query<CropMintRow>(
      "SELECT * FROM crop_mints WHERE farmer_address = $1 ORDER BY created_at DESC",
      [farmerAddress]
    );
    return rows;
  }
}
