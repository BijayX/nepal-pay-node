/** Wire formats of the Khalti KPG-2 ePayment API. Internal — not part of the public API. */

export interface KhaltiInitiateRequest {
  return_url: string;
  website_url: string;
  amount: number;
  purchase_order_id: string;
  purchase_order_name: string;
  customer_info?: { name?: string; email?: string; phone?: string };
  amount_breakdown?: { label: string; amount: number }[];
  [merchantField: `merchant_${string}`]: string;
}

export interface KhaltiInitiateResponse {
  pidx: string;
  payment_url: string;
  expires_at?: string;
  expires_in?: number;
}

export interface KhaltiLookupResponse {
  pidx: string;
  /** Paisa. Documented as a number; parsed defensively in case it arrives as a string. */
  total_amount: number | string;
  status: string;
  transaction_id: string | null;
  fee?: number | null;
  refunded?: boolean;
}
