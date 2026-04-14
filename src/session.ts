// ---------------------------------------------------------------------------
// Session verification — calls POST /v1/mobile/verify
// ---------------------------------------------------------------------------
// The merchant's backend creates the session (POST /v1/mobile/session via the
// server SDK) and passes the MobileSession to the app. This file handles only
// the post-payment verification step, which is done from within the SDK.

import { MobileHttpClient } from "./client";
import type { CheckoutResult, PayBridgeMobileConfig, Provider, VerifyResponse } from "./types";

export async function verifyPayment(
  sessionId: string,
  providerToken: string,
  config: PayBridgeMobileConfig,
): Promise<CheckoutResult> {
  const client = new MobileHttpClient(config);

  let data: VerifyResponse;
  try {
    data = await client.post<VerifyResponse>("/v1/mobile/verify", {
      session_id: sessionId,
      provider_token: providerToken,
    });
  } catch (err) {
    const msg = (err as Error).message ?? "Unknown error";

    // Surface cancellation as a distinct status
    if (msg.includes("cancelled")) {
      return { status: "cancelled", error: msg };
    }

    return { status: "failed", error: msg };
  }

  return {
    status: "success",
    payment_id: data.payment_id,
    amount: data.amount,
    provider: data.provider as Provider,
    provider_ref: data.provider_ref ?? undefined,
  };
}
