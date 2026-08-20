import { afterEach, describe, expect, test } from "bun:test";
import { PaymentSheetClient, PaymentSheetRequestError } from "./client";
import type { MobilePaymentSession } from "./types";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("PaymentSheetClient", () => {
  test("uses the configured API base URL for device requests", async () => {
    let request: { url: string; headers: Headers } | undefined;
    globalThis.fetch = (async (input, init) => {
      request = { url: String(input), headers: new Headers(init?.headers) };
      return new Response(JSON.stringify({ status: "initiated", provider: "fonepay", active_method: "fonepay_qr", expires_at: "2099-01-01T00:00:00.000Z" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const session = {
      session_id: "cs_test",
      client_secret: "mcs_test",
      amount: 1000,
      expires_at: "2099-01-01T00:00:00.000Z",
      methods: [],
    } satisfies MobilePaymentSession;

    const status = await new PaymentSheetClient("pk_test_example", session, "http://localhost:3000/").status();

    expect(request?.url).toBe("http://localhost:3000/v1/mobile/session/cs_test/status");
    expect(request?.headers.get("Authorization")).toBe("Bearer pk_test_example");
    expect(request?.headers.get("X-PayBridge-Client-Secret")).toBe("mcs_test");
    expect(status.active_method).toBe("fonepay_qr");
  });

  test("uses the exact client-secret routes for method changes and QR refreshes", async () => {
    const paths: string[] = [];
    globalThis.fetch = (async (input) => {
      paths.push(String(input));
      return new Response(JSON.stringify({ status: "pending", provider: null, expires_at: "2099-01-01T00:00:00.000Z", action: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    const session = {
      session_id: "cs_test",
      client_secret: "mcs_test",
      amount: 1000,
      expires_at: "2099-01-01T00:00:00.000Z",
      methods: [],
    } satisfies MobilePaymentSession;
    const client = new PaymentSheetClient("pk_test_example", session, "http://localhost:3000");

    await client.changeMethod();
    await client.refreshQr();

    expect(paths).toEqual([
      "http://localhost:3000/v1/mobile/session/cs_test/change-method",
      "http://localhost:3000/v1/mobile/session/cs_test/refresh-qr",
    ]);
  });

  test("sends the device platform without sending an amount", async () => {
    let body: unknown;
    globalThis.fetch = (async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ action: { type: "native_sdk", provider: "esewa", native_params: {} } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    const session = {
      session_id: "cs_test",
      client_secret: "mcs_test",
      amount: 1000,
      expires_at: "2099-01-01T00:00:00.000Z",
      methods: [],
    } satisfies MobilePaymentSession;

    await new PaymentSheetClient("pk_test_example", session).confirm("esewa", "ios", "pbmerchant://payment-return");

    expect(body).toEqual({ method: "esewa", platform: "ios", return_url: "pbmerchant://payment-return" });
  });

  test("preserves a structured API error so recoverable state is not reported as payment failure", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      error: "The payment is still active.",
      code: "method_change_not_safe",
    }), { status: 409, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    const session = {
      session_id: "cs_test",
      client_secret: "mcs_test",
      amount: 1000,
      expires_at: "2099-01-01T00:00:00.000Z",
      methods: [],
    } satisfies MobilePaymentSession;

    try {
      await new PaymentSheetClient("pk_test_example", session).changeMethod();
      throw new Error("Expected changeMethod to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentSheetRequestError);
      expect(error).toMatchObject({ status: 409, code: "method_change_not_safe" });
    }
  });
});
