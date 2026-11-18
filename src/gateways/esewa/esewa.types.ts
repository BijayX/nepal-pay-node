/** Wire formats of eSewa ePay v2. Internal — not part of the public API. */

/** Decoded `data` parameter that eSewa appends to `success_url`. Values are strings as sent. */
export interface EsewaCallbackData {
  transaction_code?: string;
  status?: string;
  total_amount: string;
  transaction_uuid: string;
  product_code: string;
  signed_field_names: string;
  signature: string;
  [field: string]: string | undefined;
}

export interface EsewaStatusResponse {
  product_code: string;
  transaction_uuid: string;
  total_amount: number | string;
  status: string;
  ref_id: string | null;
}
