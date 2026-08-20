import type { PayBridgeMobileConfig } from "../types";

export type Bank = {
  name: string;
  swift: string;
  scheme: string;
  androidPackage?: string;
  iosAppId: string;
  logo: string;
  short: string;
};

export type MobileMethod =
  | { id: "fonepay_qr"; provider: "fonepay"; label: string; logo?: string }
  | { id: "bank_intent"; provider: "fonepay"; label: string; logo?: string; banks: Bank[] }
  | { id: "esewa"; provider: "esewa"; label: string; logo?: string; esewa_intent_eligible: boolean }
  | { id: "khalti"; provider: "khalti"; label: string; logo?: string };

export type MobilePaymentSession = {
  session_id: string;
  client_secret: string;
  methods: MobileMethod[];
  amount: number;
  currency?: "NPR";
  mode?: "sandbox" | "live";
  expires_at: string;
  /** Optional until the session API exposes the merchant display name. */
  merchant_name?: string;
};

export type PaymentSheetAppearance = {
  colors?: {
    light?: Partial<PaymentSheetColors>;
    dark?: Partial<PaymentSheetColors>;
  };
  radius?: number;
  fonts?: { family?: string; headingFamily?: string };
  primaryButton?: { backgroundColor?: string; textColor?: string };
};

export type PaymentSheetColors = {
  background: string;
  surface: string;
  text: string;
  mutedText: string;
  border: string;
  primary: string;
  primaryText: string;
  danger: string;
};

export type PaymentSheetResult = {
  status: "success" | "failed" | "expired" | "cancelled";
  sessionId: string;
  provider: "fonepay" | "esewa" | "khalti" | null;
};

export type PaymentSheetOptions = {
  fetchSession: () => Promise<MobilePaymentSession>;
  publishableKey: string;
  /** Override only for staging, local development, or a PayBridgeNP-compatible host. */
  config?: Pick<PayBridgeMobileConfig, "baseUrl">;
  /** App deep link used by eSewa Intent to return to the merchant app, for example `myapp://paybridge/return`. */
  returnUrl?: string;
  appearance?: PaymentSheetAppearance;
  onComplete: (result: PaymentSheetResult) => void;
  onCancel: () => void;
  onError: (error: Error) => void;
};

export type FonepayAction = {
  type: "fonepay_qr" | "bank_intent";
  provider: "fonepay";
  qr_message: string;
  qr_image?: string;
  share_image?: string;
  events_url: string;
  expires_at: string;
  banks?: Array<Omit<Bank, "short"> & { short?: string; url: string }>;
};

export type NativeSdkAction = {
  type: "native_sdk";
  provider: "esewa" | "khalti";
  native_params: Record<string, string | number>;
};

export type MobileAction = FonepayAction | NativeSdkAction;

export type MobileStatus = {
  status: "pending" | "initiated" | "success" | "failed" | "expired" | "cancelled";
  provider: "fonepay" | "esewa" | "khalti" | null;
  active_method?: MobileMethod["id"] | null;
  expires_at: string;
};
