import type { Bank, MobileMethod } from "./types";

const METHOD_ORDER = ["bank_intent", "fonepay_qr", "esewa", "khalti"] as const;
export const STATUS_CHECK_ERROR = "We couldn’t confirm the payment status. Check your connection and try again.";

export function clearStatusCheckError(error: string | null): string | null {
  return error === STATUS_CHECK_ERROR ? null : error;
}

/** Only server-supplied methods are shown; ordering never creates availability. */
export function paymentSheetMethods(methods: readonly MobileMethod[], confirmedMethod?: string | null): MobileMethod[] {
  return METHOD_ORDER.flatMap((id) => methods.filter((method) => method.id === id && (!confirmedMethod || method.id === confirmedMethod)));
}

/** Detection can change placement, but every server-supplied bank remains selectable. */
export function orderBanks<T extends Bank>(banks: readonly T[], installedSwifts: ReadonlySet<string>): Array<T & { installed: boolean }> {
  return banks
    .map((bank) => ({ ...bank, installed: installedSwifts.has(bank.swift) }))
    .sort((a, b) => Number(b.installed) - Number(a.installed));
}

export function bankAppBehavior(installedCount: number): "hidden" | "direct" | "picker" {
  return installedCount === 0 ? "hidden" : installedCount === 1 ? "direct" : "picker";
}

export function esewaAndroidProbe(): string {
  return "esewa://d";
}

export function esewaAndroidOpenUrl(url: string, mode: "sandbox" | "live" | undefined): string | null {
  const sandbox = mode === "sandbox";
  const expectedHost = sandbox ? "rc-links.esewa.com.np" : "links.esewa.com.np";
  const match = url.match(/^https:\/\/([^/?#]+)(\/[^#]*)$/i);
  if (!match || match[1]?.toLowerCase() !== expectedHost) return null;
  return url;
}

export function secondsUntil(expiresAt: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1_000));
}

export function payableSeconds(qrExpiresAt: string, sessionExpiresAt: string, now = Date.now()): number {
  return Math.min(secondsUntil(qrExpiresAt, now), secondsUntil(sessionExpiresAt, now));
}

export function formatCountdown(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function formatAmount(amount: number): string {
  return `NPR ${(amount / 100).toLocaleString("en-NP", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function customerFacingPaymentError(message: string): string {
  const plain = message.replace(/^\[PayBridgeNP\]\s*/, "");
  return /^(network request failed|failed to fetch|load failed)$/i.test(plain)
    ? "Check your connection and try again."
    : plain;
}

export function mobileAssetUrl(url: string | undefined, apiBaseUrl: string | undefined): string | undefined {
  if (!url || !apiBaseUrl) return url;
  const match = url.match(/^https?:\/\/[^/?#]+(\/brand-logos\/[^?#]*)/i);
  return match ? `${apiBaseUrl.replace(/\/$/, "")}${match[1]}` : url;
}

export function isAllowedExternalNavigation(url: string, allowedOrigins: readonly string[]): boolean {
  // source={{ html }} starts at about:blank before the eSewa form submits.
  if (url === "about:blank") return true;
  if (/^https:\/\/www\.google\.com\/recaptcha\//i.test(url)) return true;
  const match = url.match(/^(https?:\/\/[^/?#]+)/i);
  return !!match && allowedOrigins.includes(match[1].toLowerCase());
}

export function isInlineFormDocument(url: string): boolean {
  return url === "about:blank";
}

export function externalCallbackUrls(params: Record<string, string | number>): string[] {
  return ["success_url", "failure_url", "return_url"]
    .map((key) => String(params[key] ?? ""))
    .filter((url) => /^https?:\/\//i.test(url));
}

export function externalReturnOutcome(
  provider: "esewa" | "khalti",
  url: string,
  params: Record<string, string | number>,
): "cancelled" | "returned" {
  const queryValue = (key: string) => {
    const match = url.match(new RegExp(`[?&]${key}=([^&#]*)`, "i"));
    return match?.[1] ? decodeURIComponent(match[1].replace(/\+/g, " ")) : null;
  };
  if (provider === "khalti") {
    const status = queryValue("status")?.trim().toLowerCase();
    return status === "user canceled" || status === "cancelled" || status === "canceled" ? "cancelled" : "returned";
  }
  const failureUrl = String(params.failure_url ?? "");
  return failureUrl && url.startsWith(failureUrl) && !queryValue("data") ? "cancelled" : "returned";
}
