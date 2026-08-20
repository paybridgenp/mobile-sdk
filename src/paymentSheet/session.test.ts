import { afterEach, describe, expect, test } from "bun:test";
import { verifyPayment } from "../session";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("legacy mobile verification", () => {
  test("maps a sibling-paid null payment id to an omitted public field", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      status: "success",
      payment_id: null,
      amount: 1000,
      provider: "esewa",
      provider_ref: null,
    }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;

    const result = await verifyPayment("cs_test", "provider-token", {
      baseUrl: "https://example.test",
    });

    expect(result).toEqual({ status: "success", amount: 1000, provider: "esewa" });
  });
});
