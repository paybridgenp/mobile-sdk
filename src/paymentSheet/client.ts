import type { MobileAction, MobilePaymentSession, MobileStatus } from "./types";

const DEFAULT_BASE_URL = "https://api.paybridgenp.com";

export class PaymentSheetRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(`[PayBridgeNP] ${message}`);
    this.name = "PaymentSheetRequestError";
  }
}

export class PaymentSheetClient {
  constructor(
    private readonly publishableKey: string,
    private readonly session: MobilePaymentSession,
    private readonly baseUrl = DEFAULT_BASE_URL,
  ) {}

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.publishableKey}`,
        "X-PayBridge-Client-Secret": this.session.client_secret,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.ok) return response.json() as Promise<T>;
    let message = `HTTP ${response.status}`;
    let code: string | undefined;
    try {
      const data = await response.json() as { error?: string | { message?: string; code?: string }; code?: string };
      message = typeof data.error === "string" ? data.error : data.error?.message ?? message;
      code = data.code ?? (typeof data.error === "object" ? data.error?.code : undefined);
    } catch {}
    throw new PaymentSheetRequestError(message, response.status, code);
  }

  confirm(method: MobilePaymentSession["methods"][number]["id"], platform?: "ios" | "android", returnUrl?: string): Promise<{ action: MobileAction }> {
    // Amount deliberately never crosses this boundary: it belongs to the session snapshot.
    return this.request("POST", `/v1/mobile/session/${this.session.session_id}/confirm`, { method, ...(platform ? { platform } : {}), ...(returnUrl ? { return_url: returnUrl } : {}) });
  }

  changeMethod(): Promise<MobileStatus> {
    return this.request("POST", `/v1/mobile/session/${this.session.session_id}/change-method`);
  }

  refreshQr(): Promise<{ action: Extract<MobileAction, { provider: "fonepay" }> }> {
    return this.request("POST", `/v1/mobile/session/${this.session.session_id}/refresh-qr`);
  }

  status(): Promise<MobileStatus> {
    return this.request("GET", `/v1/mobile/session/${this.session.session_id}/status`);
  }
}
