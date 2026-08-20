import { useCallback, useRef, useState } from "react";
import type { PaymentSheetOptions } from "../paymentSheet/types";

/** Fetches the merchant-backend session before opening the provider-free payment sheet. */
export function usePaymentSheet(options: PaymentSheetOptions) {
  const [visible, setVisible] = useState(false);
  const [session, setSession] = useState<Awaited<ReturnType<typeof options.fetchSession>> | null>(null);
  const [loading, setLoading] = useState(false);
  const presenting = useRef(false);

  const present = useCallback(async () => {
    if (presenting.current) return;
    presenting.current = true;
    setLoading(true);
    try { setSession(await options.fetchSession()); setVisible(true); }
    catch (cause) { options.onError(cause as Error); }
    finally { presenting.current = false; setLoading(false); }
  }, [options]);
  const resume = useCallback((nextSession: Awaited<ReturnType<typeof options.fetchSession>>) => {
    setSession(nextSession);
    setVisible(true);
  }, []);
  const dismiss = useCallback(() => { setVisible(false); options.onCancel(); }, [options]);
  const complete = useCallback((result: Parameters<typeof options.onComplete>[0]) => { setVisible(false); options.onComplete(result); }, [options]);

  return { present, resume, dismiss, isVisible: visible, loading, paymentSheetProps: { visible, session, publishableKey: options.publishableKey, config: options.config, returnUrl: options.returnUrl, appearance: options.appearance, onComplete: complete, onCancel: dismiss, onError: options.onError } };
}
