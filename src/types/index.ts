export type Provider = "esewa" | "khalti";

export type PayBridgeMobileConfig = {
  /** PayBridge API base URL. Default: https://api.paybridgenp.com */
  baseUrl?: string;
  /** Request timeout in ms. Default: 30000 */
  timeout?: number;
};

/**
 * Parameters for POST /v1/mobile/session — called from your backend.
 * customer is required for mobile sessions (no hosted checkout page to collect it).
 */
export type CreateMobileSessionParams = {
  amount: number;       // in paisa (1 NPR = 100 paisa)
  provider: Provider;   // "esewa" | "khalti"
  currency?: "NPR";
  description?: string;
  metadata?: Record<string, unknown>;
  customer: {
    name: string;
    email: string;
    phone: string;
  };
};

/**
 * Returned by your backend after calling POST /v1/mobile/session.
 * Pass this directly to PayBridgeSheet or usePayBridge.
 * Never store this on the device — it expires in 15 minutes.
 */
export type MobileSession = {
  session_id: string;
  expires_at: string;
  provider: Provider;
  /** Payment amount in paisa (1 NPR = 100 paisa) */
  amount: number;
  native_params: Record<string, string | number>;
};

export type CheckoutStatus = "success" | "failed" | "cancelled";

export type CheckoutResult = {
  status: CheckoutStatus;
  payment_id?: string;
  amount?: number;          // in paisa
  provider?: Provider;
  provider_ref?: string;
  error?: string;
};

export type VerifyResponse = {
  status: "success";
  payment_id: string;
  amount: number;
  provider: string;
  provider_ref: string | null;
};
