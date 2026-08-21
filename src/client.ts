// ---------------------------------------------------------------------------
// HTTP client — thin fetch wrapper, same retry/backoff pattern as the JS SDK
// ---------------------------------------------------------------------------

import type { PayBridgeNPMobileConfig } from "./types";

const DEFAULT_BASE_URL = "https://api.paybridgenp.com";
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const RETRY_STATUSES = new Set([500, 502, 503, 504]);
const INITIAL_BACKOFF_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function backoff(attempt: number): number {
  return INITIAL_BACKOFF_MS * 2 ** (attempt - 1) + Math.random() * 100;
}

export class MobileHttpClient {
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(config: PayBridgeNPMobileConfig = {}) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "PayBridgeNP-MobileSDK/1.0.4",
    };

    let attempt = 0;

    while (true) {
      attempt++;

      // AbortSignal.timeout() is not available in React Native's JS runtime —
      // use AbortController + setTimeout as a cross-platform substitute.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);

      let res: Response;
      try {
        res = await fetch(url, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        if (attempt > DEFAULT_MAX_RETRIES) {
          throw new Error(`[PayBridgeNP] Connection error: ${(err as Error).message}`);
        }
        await sleep(backoff(attempt));
        continue;
      }

      clearTimeout(timer);

      if (res.ok) return res.json() as Promise<T>;

      if (RETRY_STATUSES.has(res.status) && attempt <= DEFAULT_MAX_RETRIES) {
        await sleep(backoff(attempt));
        continue;
      }

      let raw: Record<string, unknown> | null = null;
      try {
        raw = (await res.json()) as Record<string, unknown>;
      } catch {}

      // v3+ shape: { error: { message, type, code, request_id, ... } }
      // pre-v3:    { error: "string", code: "..." }
      let message = `HTTP ${res.status}`;
      const errObj = raw && typeof raw.error === "object" ? raw.error as Record<string, unknown> : null;
      if (errObj && typeof errObj.message === "string") {
        message = errObj.message;
      } else if (typeof raw?.error === "string") {
        message = raw.error;
      }
      throw new Error(`[PayBridgeNP] ${message}`);
    }
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }
}
