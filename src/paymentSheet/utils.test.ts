import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Bank, MobileMethod } from "./types";
import { bankAppBehavior, clearStatusCheckError, customerFacingPaymentError, esewaAndroidOpenUrl, esewaAndroidProbe, externalCallbackUrls, externalReturnOutcome, formatCountdown, isAllowedExternalNavigation, isInlineFormDocument, mobileAssetUrl, orderBanks, payableSeconds, paymentSheetMethods, STATUS_CHECK_ERROR } from "./utils";

const sampleBank: Bank & { url: string } = {
  name: "Example Bank", swift: "EXMP", scheme: "examplebank://pay", androidPackage: "com.example.bank", iosAppId: "123", logo: "https://checkout.paybridgenp.com/logo.png", short: "EB", url: "examplebank://pay?server_payload=opaque",
};

describe("paymentSheetMethods", () => {
  test("does not create a row for a method the server did not send", () => {
    const methods: MobileMethod[] = [
      { id: "esewa", provider: "esewa", label: "eSewa", esewa_intent_eligible: false },
      { id: "khalti", provider: "khalti", label: "Khalti" },
    ];
    const renderedIds = paymentSheetMethods(methods).map((method) => method.id);
    expect(renderedIds).toEqual(["esewa", "khalti"]);
    expect(renderedIds).not.toContain("fonepay_qr");
    expect(renderedIds).not.toContain("bank_intent");
  });

  test("uses the server's flat row order without inventing an extra method", () => {
    const methods: MobileMethod[] = [
      { id: "khalti", provider: "khalti", label: "Khalti" },
      { id: "fonepay_qr", provider: "fonepay", label: "Fonepay QR" },
      { id: "bank_intent", provider: "fonepay", label: "Bank App", banks: [] },
      { id: "esewa", provider: "esewa", label: "eSewa", esewa_intent_eligible: true },
    ];
    expect(paymentSheetMethods(methods).map((method) => method.id)).toEqual(["bank_intent", "fonepay_qr", "esewa", "khalti"]);
    expect(paymentSheetMethods(methods, "esewa").map((method) => method.id)).toEqual(["esewa"]);
  });
});

describe("orderBanks", () => {
  test("pins detected banks but preserves an undetected bank and its server URL as tappable data", () => {
    const undetected = { ...sampleBank, swift: "UNDT", name: "Undetected Bank" };
    const rows = orderBanks([undetected, sampleBank], new Set([sampleBank.swift]));
    expect(rows.map((bank) => bank.swift)).toEqual(["EXMP", "UNDT"]);
    expect(rows.find((bank) => bank.swift === "UNDT")).toMatchObject({ installed: false, url: undetected.url });
    expect(rows).toHaveLength(2);
  });
});

test("bank app skips a redundant picker when exactly one supported app is installed", () => {
  expect([0, 1, 2].map(bankAppBehavior)).toEqual(["hidden", "direct", "picker"]);
});

test("eSewa app detection stays in the session's provider environment", () => {
  expect(esewaAndroidProbe()).toBe("esewa://d");
  expect(esewaAndroidOpenUrl("https://rc-links.esewa.com.np/pay/book_123", "sandbox")).toBe("https://rc-links.esewa.com.np/pay/book_123");
  expect(esewaAndroidOpenUrl("https://links.esewa.com.np/pay/book_123", "live")).toBe("https://links.esewa.com.np/pay/book_123");
  expect(esewaAndroidOpenUrl("https://evil.example/pay/book_123", "live")).toBeNull();
});

test("provider returns include Khalti return_url and ignore non-HTTP values", () => {
  expect(externalCallbackUrls({
    success_url: "https://api.example/mobile/noop",
    failure_url: "javascript:alert(1)",
    return_url: "https://api.example/mobile/noop",
  })).toEqual([
    "https://api.example/mobile/noop",
    "https://api.example/mobile/noop",
  ]);
});

test("provider-declared cancellations are distinct from successful returns", () => {
  const esewa = { failure_url: "https://api.example/mobile/noop", success_url: "https://api.example/mobile/noop" };
  expect(externalReturnOutcome("esewa", "https://api.example/mobile/noop", esewa)).toBe("cancelled");
  expect(externalReturnOutcome("esewa", "https://api.example/mobile/noop?data=signed-result", esewa)).toBe("returned");
  expect(externalReturnOutcome("khalti", "https://api.example/mobile/noop?status=User%20canceled", {})).toBe("cancelled");
  expect(externalReturnOutcome("khalti", "https://api.example/mobile/noop?status=Completed", {})).toBe("returned");
});

test("inline eSewa HTML may load but unrelated origins stay blocked", () => {
  expect(isAllowedExternalNavigation("about:blank", ["https://esewa.test"])).toBe(true);
  expect(isAllowedExternalNavigation("https://www.google.com/recaptcha/api2/anchor?k=test", ["https://esewa.test"])).toBe(true);
  expect(isAllowedExternalNavigation("https://www.google.com/search?q=payment", ["https://esewa.test"])).toBe(false);
  expect(isInlineFormDocument("about:blank")).toBe(true);
  expect(isInlineFormDocument("https://esewa.test/pay")).toBe(false);
  expect(isAllowedExternalNavigation("https://esewa.test/pay", ["https://esewa.test"])).toBe(true);
  expect(isAllowedExternalNavigation("https://evil.test/pay", ["https://esewa.test"])).toBe(false);
});

test("countdown is customer-readable minutes and seconds", () => {
  expect(formatCountdown(890)).toBe("14:50");
});

test("QR countdown never outlives its checkout session", () => {
  const now = Date.parse("2026-08-20T00:00:00Z");
  expect(payableSeconds("2026-08-20T00:02:00Z", "2026-08-20T00:01:00Z", now)).toBe(60);
});

test("customer errors omit the developer-only SDK prefix", () => {
  expect(customerFacingPaymentError("[PayBridgeNP] Provider unavailable")).toBe("Provider unavailable");
  expect(customerFacingPaymentError("Network request failed")).toBe("Check your connection and try again.");
});

test("a successful status retry clears only the connection error", () => {
  expect(clearStatusCheckError(STATUS_CHECK_ERROR)).toBeNull();
  expect(clearStatusCheckError("Provider unavailable")).toBe("Provider unavailable");
});

test("iOS keeps Khalti's split OTP fields on the numeric keyboard", () => {
  const source = readFileSync(new URL("./ExternalPaymentScreen.tsx", import.meta.url), "utf8");
  expect(source).toContain(".MuiOtpInput-TextField input");
  expect(source).toContain("setAttribute('type','tel')");
  expect(source).toContain("setAttribute('inputmode','numeric')");
});

test("mobile brand assets follow the SDK API origin without rewriting third-party images", () => {
  expect(mobileAssetUrl("http://192.0.2.1/brand-logos/esewa.png", "http://127.0.0.1:3000"))
    .toBe("http://127.0.0.1:3000/brand-logos/esewa.png");
  expect(mobileAssetUrl("https://merchant.example/logo.png", "http://127.0.0.1:3000"))
    .toBe("https://merchant.example/logo.png");
});
