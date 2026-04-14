import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ProviderButton } from "./ProviderButton";
import { EsewaWebView } from "./EsewaWebView";
import { KhaltiWebView } from "./KhaltiWebView";
import { verifyPayment } from "../session";
import type { CheckoutResult, MobileSession, PayBridgeMobileConfig, Provider } from "../types";

type Props = {
  visible: boolean;
  /**
   * Pre-built session from your backend. Required if createSession is not provided.
   * When passed, only the session's own provider is shown.
   */
  session?: MobileSession;
  /**
   * Lazy session factory — called when the user taps a provider button.
   * Use this instead of `session` to let the user pick the provider first.
   * Both Khalti and eSewa buttons are shown until one is tapped.
   */
  createSession?: (provider: Provider) => Promise<MobileSession>;
  /** Amount in paisa — shown while session is being created in lazy mode */
  amount?: number;
  config?: PayBridgeMobileConfig;
  onSuccess: (result: CheckoutResult) => void;
  onFailure: (result: CheckoutResult) => void;
  onCancel: () => void;
};

const SHEET_HEIGHT = Dimensions.get("window").height * 0.52;

export function ProviderSheet({
  visible,
  session: sessionProp,
  createSession,
  amount: amountProp,
  config = {},
  onSuccess,
  onFailure,
  onCancel,
}: Props) {
  const slideAnim = useRef(new Animated.Value(SHEET_HEIGHT)).current;

  // When createSession is used, session is built lazily after provider is picked.
  const [session, setSession] = useState<MobileSession | null>(sessionProp ?? null);
  const [creatingProvider, setCreatingProvider] = useState<Provider | null>(null);
  const [verifyingProvider, setVerifyingProvider] = useState<Provider | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [esewaWebViewVisible, setEsewaWebViewVisible] = useState(false);
  const [khaltiWebViewVisible, setKhaltiWebViewVisible] = useState(false);

  // Sync sessionProp changes
  useEffect(() => {
    if (sessionProp) setSession(sessionProp);
  }, [sessionProp]);

  // Reset when sheet becomes visible
  useEffect(() => {
    if (visible) {
      setErrorMsg(null);
      if (!sessionProp) setSession(null);
      setCreatingProvider(null);
      setVerifyingProvider(null);
    }
  }, [visible]);

  useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 4,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: SHEET_HEIGHT,
        duration: 220,
        useNativeDriver: true,
      }).start();
    }
  }, [visible]);

  const isBusy = creatingProvider !== null || verifyingProvider !== null;

  function handleClose() {
    if (isBusy || esewaWebViewVisible || khaltiWebViewVisible) return;
    onCancel();
  }

  // ── Provider selection (lazy mode) ──────────────────────────────────────────

  async function handleSelectProvider(provider: Provider) {
    if (isBusy) return;
    setErrorMsg(null);

    if (createSession) {
      // Lazy: create the session now
      setCreatingProvider(provider);
      try {
        const s = await createSession(provider);
        setSession(s);
        setCreatingProvider(null);
        openWebView(provider);
      } catch (err: any) {
        setCreatingProvider(null);
        setErrorMsg(err?.error ?? err?.message ?? "Failed to create payment session");
      }
    } else if (session) {
      // Pre-built: use existing session
      openWebView(provider);
    }
  }

  function openWebView(provider: Provider) {
    if (provider === "esewa") setEsewaWebViewVisible(true);
    else setKhaltiWebViewVisible(true);
  }

  // ── eSewa WebView callbacks ─────────────────────────────────────────────────

  async function handleEsewaSuccess(base64Data: string) {
    setEsewaWebViewVisible(false);
    setVerifyingProvider("esewa");
    const result = await verifyPayment(session!.session_id, base64Data, config);
    setVerifyingProvider(null);
    handleResult(result);
  }

  function handleEsewaFailure(message: string) {
    setEsewaWebViewVisible(false);
    setErrorMsg(message);
    // Reset lazy session so user can retry with same or different provider
    if (createSession) setSession(null);
  }

  function handleEsewaCancel() {
    setEsewaWebViewVisible(false);
    if (createSession) setSession(null);
    onCancel();
  }

  // ── Khalti WebView callbacks ────────────────────────────────────────────────

  async function handleKhaltiSuccess(pidx: string) {
    setKhaltiWebViewVisible(false);
    setVerifyingProvider("khalti");
    const result = await verifyPayment(session!.session_id, pidx, config);
    setVerifyingProvider(null);
    handleResult(result);
  }

  function handleKhaltiFailure(message: string) {
    setKhaltiWebViewVisible(false);
    setErrorMsg(message);
    if (createSession) setSession(null);
  }

  function handleKhaltiCancel() {
    setKhaltiWebViewVisible(false);
    if (createSession) setSession(null);
    onCancel();
  }

  // ── Result ──────────────────────────────────────────────────────────────────

  function handleResult(result: CheckoutResult) {
    if (result.status === "success") onSuccess(result);
    else if (result.status === "cancelled") onCancel();
    else {
      setErrorMsg(result.error ?? "Payment could not be completed. Please try again.");
      if (createSession) setSession(null);
      onFailure(result);
    }
  }

  // ── Amount display ──────────────────────────────────────────────────────────
  // Use top-level session.amount (paisa) when available; never rely on
  // native_params.amount which is provider-specific (rupees for eSewa, paisa for Khalti).

  const amountPaisa = session?.amount ?? amountProp ?? null;
  const formattedAmount = amountPaisa != null
    ? `NPR ${(amountPaisa / 100).toLocaleString("en-NP", { minimumFractionDigits: 2 })}`
    : "NPR —";

  // Which providers to show: if session is pre-built, show only that provider;
  // if lazy, show all until one is chosen.
  const showKhalti = !session || session.provider === "khalti";
  const showEsewa = !session || session.provider === "esewa";

  return (
    <>
      {/* ── Provider picker sheet ── */}
      <Modal
        visible={visible && !esewaWebViewVisible && !khaltiWebViewVisible}
        transparent
        animationType="none"
        onRequestClose={handleClose}
        statusBarTranslucent={Platform.OS === "android"}
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={handleClose} />

        <Animated.View style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}>
          <SafeAreaView edges={["bottom"]}>
            <View style={styles.handleContainer}>
              <View style={styles.handle} />
            </View>

            <View style={styles.header}>
              <View>
                <Text style={styles.title}>Choose payment method</Text>
                <Text style={styles.amount}>{formattedAmount}</Text>
              </View>
              <TouchableOpacity
                onPress={handleClose}
                disabled={isBusy}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={[styles.closeBtn, isBusy && styles.closeBtnDisabled]}>✕</Text>
              </TouchableOpacity>
            </View>

            {errorMsg ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{errorMsg}</Text>
              </View>
            ) : null}

            <View style={styles.providers}>
              {/* During verify, show only the active provider with loading */}
              {verifyingProvider ? (
                <ProviderButton
                  provider={verifyingProvider}
                  onPress={() => {}}
                  loading
                  disabled={false}
                />
              ) : (
                <>
                  {showKhalti && (
                    <ProviderButton
                      provider="khalti"
                      onPress={() => void handleSelectProvider("khalti")}
                      loading={creatingProvider === "khalti"}
                      disabled={isBusy && creatingProvider !== "khalti"}
                    />
                  )}
                  {showEsewa && (
                    <ProviderButton
                      provider="esewa"
                      onPress={() => void handleSelectProvider("esewa")}
                      loading={creatingProvider === "esewa"}
                      disabled={isBusy && creatingProvider !== "esewa"}
                    />
                  )}
                </>
              )}
            </View>

            <Text style={styles.footer}>Powered by PayBridge NP</Text>
          </SafeAreaView>
        </Animated.View>
      </Modal>

      {/* ── eSewa full-screen WebView ── */}
      {session && (
        <EsewaWebView
          visible={esewaWebViewVisible}
          native_params={session.native_params}
          onSuccess={handleEsewaSuccess}
          onFailure={handleEsewaFailure}
          onCancel={handleEsewaCancel}
        />
      )}

      {/* ── Khalti full-screen WebView ── */}
      {session && (
        <KhaltiWebView
          visible={khaltiWebViewVisible}
          native_params={session.native_params}
          onSuccess={handleKhaltiSuccess}
          onFailure={handleKhaltiFailure}
          onCancel={handleKhaltiCancel}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#F7F7F7",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 20,
  },
  handleContainer: { alignItems: "center", paddingVertical: 12 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D0D0D0" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  title: { fontSize: 16, fontWeight: "700", color: "#111" },
  amount: { fontSize: 22, fontWeight: "800", color: "#111", marginTop: 2 },
  closeBtn: { fontSize: 18, color: "#888", fontWeight: "500" },
  closeBtnDisabled: { opacity: 0.3 },
  errorBox: {
    backgroundColor: "#FEF2F2",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#FCA5A5",
  },
  errorText: { color: "#B91C1C", fontSize: 13, lineHeight: 18 },
  providers: { gap: 4 },
  footer: { textAlign: "center", fontSize: 11, color: "#AAA", marginTop: 16, marginBottom: 4 },
});
