import { useCallback, useState } from "react";
import type { CheckoutResult, MobileSession, PayBridgeMobileConfig, Provider } from "../types";

type UsePayBridgeOptions = {
  /**
   * Pre-built session from your backend. Use this when you create the session
   * before the user picks a provider (e.g. provider is pre-selected).
   */
  session?: MobileSession | null;
  /**
   * Lazy session factory — called when the user taps a provider button.
   * Use this to let the user pick the provider first; both buttons are shown.
   */
  createSession?: (provider: Provider) => Promise<MobileSession>;
  /**
   * Amount in paisa — shown while no session exists yet (lazy mode).
   */
  amount?: number;
  config?: PayBridgeMobileConfig;
  onSuccess: (result: CheckoutResult) => void;
  onFailure: (result: CheckoutResult) => void;
  onCancel: () => void;
};

type SheetProps = {
  visible: boolean;
  session?: MobileSession;
  createSession?: (provider: Provider) => Promise<MobileSession>;
  amount?: number;
  config?: PayBridgeMobileConfig;
  onSuccess: (result: CheckoutResult) => void;
  onFailure: (result: CheckoutResult) => void;
  onCancel: () => void;
};

type UsePayBridgeReturn = {
  /** Open the payment sheet. */
  present: () => void;
  /** Programmatically close the sheet (fires onCancel). */
  dismiss: () => void;
  /** Whether the sheet is currently open. */
  isVisible: boolean;
  /**
   * Spread directly onto <ProviderSheet />.
   *
   * @example
   * ```tsx
   * const { present, sheetProps } = usePayBridge({ ... });
   *
   * <Button onPress={present} title="Pay Now" />
   * <ProviderSheet {...sheetProps} />
   * ```
   */
  sheetProps: SheetProps;
};

/**
 * Manages PayBridge sheet visibility and wires callbacks.
 *
 * @example — lazy mode (user picks provider)
 * ```tsx
 * const { present, sheetProps } = usePayBridge({
 *   createSession: async (provider) => {
 *     const res = await fetch("/api/mobile-session", {
 *       method: "POST",
 *       body: JSON.stringify({ provider, amount: 5000 }),
 *     });
 *     return res.json();
 *   },
 *   amount: 5000,
 *   onSuccess: (r) => console.log("paid", r.payment_id),
 *   onFailure: (r) => console.log("failed", r.error),
 *   onCancel:  () => console.log("cancelled"),
 * });
 *
 * <Button onPress={present} title="Pay Now" />
 * <ProviderSheet {...sheetProps} />
 * ```
 *
 * @example — pre-built session mode
 * ```tsx
 * const { present, sheetProps } = usePayBridge({
 *   session,
 *   onSuccess: (r) => console.log("paid", r.payment_id),
 *   onFailure: (r) => console.log("failed", r.error),
 *   onCancel:  () => console.log("cancelled"),
 * });
 * ```
 */
export function usePayBridge({
  session,
  createSession,
  amount,
  config,
  onSuccess,
  onFailure,
  onCancel,
}: UsePayBridgeOptions): UsePayBridgeReturn {
  const [isVisible, setIsVisible] = useState(false);

  const present = useCallback(() => {
    if (!session && !createSession) {
      console.warn(
        "[PayBridge] usePayBridge: pass either `session` or `createSession` before calling present().",
      );
      return;
    }
    setIsVisible(true);
  }, [session, createSession]);

  const dismiss = useCallback(() => {
    setIsVisible(false);
    onCancel();
  }, [onCancel]);

  const handleSuccess = useCallback(
    (result: CheckoutResult) => {
      setIsVisible(false);
      onSuccess(result);
    },
    [onSuccess],
  );

  const handleFailure = useCallback(
    (result: CheckoutResult) => {
      setIsVisible(false);
      onFailure(result);
    },
    [onFailure],
  );

  const handleCancel = useCallback(() => {
    setIsVisible(false);
    onCancel();
  }, [onCancel]);

  const sheetProps: SheetProps = {
    visible: isVisible,
    ...(session ? { session } : {}),
    ...(createSession ? { createSession } : {}),
    ...(amount !== undefined ? { amount } : {}),
    config,
    onSuccess: handleSuccess,
    onFailure: handleFailure,
    onCancel: handleCancel,
  };

  return { present, dismiss, isVisible, sheetProps };
}
