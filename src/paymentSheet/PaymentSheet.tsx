import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, Appearance, Image, Linking, Modal, NativeModules, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import EventSource from "react-native-sse";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { PaymentSheetClient, PaymentSheetRequestError } from "./client";
import { ExternalPaymentScreen } from "./ExternalPaymentScreen";
import { NativeQr } from "./NativeQr";
import type { Bank, FonepayAction, MobileAction, MobileMethod, MobilePaymentSession, NativeSdkAction, PaymentSheetAppearance, PaymentSheetColors, PaymentSheetOptions, PaymentSheetResult } from "./types";
import { bankAppBehavior, clearStatusCheckError, customerFacingPaymentError, esewaAndroidOpenUrl, esewaAndroidProbe, formatAmount, formatCountdown, mobileAssetUrl, orderBanks, payableSeconds, paymentSheetMethods, secondsUntil, STATUS_CHECK_ERROR } from "./utils";

export type PaymentSheetProps = {
  visible: boolean;
  session: MobilePaymentSession | null;
  publishableKey: string;
  config?: PaymentSheetOptions["config"];
  returnUrl?: string;
  appearance?: PaymentSheetAppearance;
  onComplete: (result: PaymentSheetResult) => void;
  onCancel: () => void;
  onError: (error: Error) => void;
};

type FonepayPhase = "waiting" | "scanned" | "refreshing" | "expired";
type IntentPhase = "idle" | "opening" | "checking" | "cancelling" | "returned" | "unavailable";

const lightColors: PaymentSheetColors = { background: "#F3F4F6", surface: "#FFFFFF", text: "#111827", mutedText: "#6B7280", border: "#E5E7EB", primary: "#1459D9", primaryText: "#FFFFFF", danger: "#B42318" };
const darkColors: PaymentSheetColors = { background: "#17191E", surface: "#23262D", text: "#F7F8FA", mutedText: "#AEB3BD", border: "#353941", primary: "#79A6FF", primaryText: "#0B1220", danger: "#FDA4AF" };

function colorsFor(appearance?: PaymentSheetAppearance): PaymentSheetColors {
  const baseline = Appearance.getColorScheme() === "dark" ? darkColors : lightColors;
  const theme = Appearance.getColorScheme() === "dark" ? appearance?.colors?.dark : appearance?.colors?.light;
  return { ...baseline, ...theme, primary: appearance?.primaryButton?.backgroundColor ?? theme?.primary ?? baseline.primary, primaryText: appearance?.primaryButton?.textColor ?? theme?.primaryText ?? baseline.primaryText };
}

function BankLogo({ bank, colors, apiBaseUrl }: { bank: Bank; colors: PaymentSheetColors; apiBaseUrl?: string }) {
  const [failed, setFailed] = useState(!bank.logo);
  if (failed) return <View style={[styles.logoTile, { borderColor: colors.border }]}><Text style={{ color: "#374151", fontWeight: "700" }}>{bank.short}</Text></View>;
  return <View style={[styles.logoTile, { borderColor: colors.border }]}><Image resizeMode="contain" source={{ uri: mobileAssetUrl(bank.logo, apiBaseUrl) }} style={styles.logo} onError={() => setFailed(true)} /></View>;
}

function MethodLogo({ method, colors, apiBaseUrl }: { method: MobileMethod; colors: PaymentSheetColors; apiBaseUrl?: string }) {
  const [failed, setFailed] = useState(!method.logo);
  if (failed) return <View style={[styles.logoTile, { borderColor: colors.border }]}><Text style={{ color: "#374151", fontWeight: "700" }}>{method.label.slice(0, 2)}</Text></View>;
  return <View style={[styles.logoTile, { borderColor: colors.border }]}><Image resizeMode="contain" source={{ uri: mobileAssetUrl(method.logo, apiBaseUrl) }} style={styles.logo} onError={() => setFailed(true)} /></View>;
}

function fonepayBanks(methods: MobileMethod[], action: FonepayAction): Array<Bank & { url?: string }> {
  const snapshot = methods.find((method): method is Extract<MobileMethod, { id: "bank_intent" }> => method.id === "bank_intent")?.banks ?? [];
  return (action.banks ?? []).map((bank) => ({ ...bank, short: bank.short ?? snapshot.find((item) => item.swift === bank.swift)?.short ?? bank.name.slice(0, 2).toUpperCase() }));
}

async function isInstalled(bank: Bank): Promise<boolean> {
  try {
    if (Platform.OS === "android") {
      if (!bank.androidPackage) return false;
      return await Linking.canOpenURL(bank.scheme);
    }
    return await Linking.canOpenURL(bank.scheme);
  } catch { return false; }
}

async function isProviderAppInstalled(scheme: string): Promise<boolean> {
  try { return await Linking.canOpenURL(scheme); }
  catch { return false; }
}

async function isEsewaInstalled(): Promise<boolean> {
  if (Platform.OS !== "android") return isProviderAppInstalled("esewa://");
  return isProviderAppInstalled(esewaAndroidProbe());
}

export function PaymentSheet({ visible, session, publishableKey, config, returnUrl, appearance, onComplete, onCancel, onError }: PaymentSheetProps) {
  const [action, setAction] = useState<MobileAction | null>(null);
  const [confirmation, setConfirmation] = useState<{ sessionId: string; method: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bankPicker, setBankPicker] = useState(false);
  const [installedSwifts, setInstalledSwifts] = useState<ReadonlySet<string>>(new Set());
  const [selectedBank, setSelectedBank] = useState<(Bank & { url?: string }) | null>(null);
  const [bankChecking, setBankChecking] = useState(false);
  const [bankQrVisible, setBankQrVisible] = useState(false);
  const [esewaInstalled, setEsewaInstalled] = useState<boolean | null>(null);
  const [intentLaunched, setIntentLaunched] = useState(false);
  const [intentPhase, setIntentPhase] = useState<IntentPhase>("idle");
  const [externalReturned, setExternalReturned] = useState(false);
  const [exitConfirmation, setExitConfirmation] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [fonepayPhase, setFonepayPhase] = useState<FonepayPhase>("waiting");
  const source = useRef<EventSource<"qr.scanned" | "qr.paid" | "qr.expired"> | null>(null);
  const currentQr = useRef<string | null>(null);
  const scannedQr = useRef<string | null>(null);
  const currentFonepay = useRef<FonepayAction | null>(null);
  const qrRefreshing = useRef(false);
  const qrSharing = useRef(false);
  const lastAutoRefreshQr = useRef<string | null>(null);
  const intentAppOpen = useRef(false);
  const bankAppOpen = useRef(false);
  const returnCheckActive = useRef(false);
  const returnRecheck = useRef<ReturnType<typeof setTimeout> | null>(null);
  const terminalReported = useRef(false);
  const colors = colorsFor(appearance);
  const client = useMemo(() => session ? new PaymentSheetClient(publishableKey, session, config?.baseUrl) : null, [publishableKey, session, config?.baseUrl]);
  const merchantName = session?.merchant_name ?? "PayBridgeNP merchant";

  const closeSse = () => { source.current?.close(); source.current = null; };
  const reportStatus = async () => {
    if (!client || !session) return null;
    try {
      const status = await client.status();
      setError(clearStatusCheckError);
      if ((status.status === "success" || status.status === "expired") && !terminalReported.current) {
        terminalReported.current = true;
        closeSse();
        onComplete({ status: status.status, sessionId: session.session_id, provider: status.provider });
      }
      return status.status;
    } catch {
      setError(STATUS_CHECK_ERROR);
      return null;
    }
  };

  const handleExternalReturn = async (outcome: "cancelled" | "returned" = "returned") => {
    if (outcome === "cancelled") {
      if (returnRecheck.current) clearTimeout(returnRecheck.current);
      returnRecheck.current = null;
      setExternalReturned(true);
      setIntentPhase("cancelling");
      await chooseAnotherMethod();
      return;
    }
    if (returnCheckActive.current) return;
    if (returnRecheck.current) clearTimeout(returnRecheck.current);
    returnRecheck.current = null;
    returnCheckActive.current = true;
    intentAppOpen.current = false;
    setExternalReturned(true);
    setIntentPhase("checking");
    try {
      const status = await reportStatus();
      if (!status) {
        setIntentPhase("returned");
        return;
      }
      if (status === "failed" || status === "cancelled") {
        await chooseAnotherMethod();
        return;
      }
      if (status === "pending" || status === "initiated") {
        setIntentPhase("returned");
        returnRecheck.current = setTimeout(() => {
          returnRecheck.current = null;
          void reportStatus().then((next) => {
            if (next === "failed" || next === "cancelled") void chooseAnotherMethod();
          });
        }, 10_500);
      }
    } finally {
      returnCheckActive.current = false;
    }
  };

  useEffect(() => {
    closeSse(); terminalReported.current = false; currentQr.current = null; scannedQr.current = null; currentFonepay.current = null; qrRefreshing.current = false; qrSharing.current = false; lastAutoRefreshQr.current = null; intentAppOpen.current = false; bankAppOpen.current = false; returnCheckActive.current = false;
    if (returnRecheck.current) clearTimeout(returnRecheck.current);
    returnRecheck.current = null;
    setAction(null); setConfirmation(null); setBusy(null); setBankPicker(false); setSelectedBank(null); setBankChecking(false); setBankQrVisible(false); setError(null); setIntentLaunched(false); setIntentPhase("idle"); setExternalReturned(false); setExitConfirmation(false); setFonepayPhase("waiting"); setEsewaInstalled(null);
    if (!visible || !session) return;
    setSeconds(secondsUntil(session.expires_at));
    const clock = setInterval(() => setSeconds(secondsUntil(session.expires_at)), 1_000);
    void restoreActiveSession();
    const appState = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      if (intentAppOpen.current) void handleExternalReturn();
      else if (bankAppOpen.current) {
        bankAppOpen.current = false;
        setBankChecking(true);
        if (currentFonepay.current) subscribeToFonepay(currentFonepay.current);
        void reportStatusAndRecover().finally(() => setBankChecking(false));
      } else void reportStatusAndRecover();
    });
    const link = returnUrl ? Linking.addEventListener("url", ({ url }) => { if (url.startsWith(returnUrl)) void reportStatusAndRecover(); }) : null;
    return () => { clearInterval(clock); appState.remove(); link?.remove(); closeSse(); if (returnRecheck.current) clearTimeout(returnRecheck.current); };
  }, [visible, session?.session_id, returnUrl]);

  useEffect(() => {
    if (visible && session && seconds === 0 && Date.now() >= new Date(session.expires_at).getTime()) {
      void reportStatus();
    }
  }, [seconds, visible, session?.session_id]);

  useEffect(() => {
    if (
      visible &&
      action?.provider === "fonepay" &&
      seconds > 0 &&
      secondsUntil(action.expires_at) === 0 &&
      (!selectedBank || bankQrVisible) &&
      lastAutoRefreshQr.current !== action.qr_message
    ) {
      lastAutoRefreshQr.current = action.qr_message;
      void refreshFonepayQr(action);
    }
  }, [seconds, visible, action, selectedBank?.swift, bankQrVisible]);

  useEffect(() => {
    const method = session?.methods.find((candidate): candidate is Extract<MobileMethod, { id: "bank_intent" }> => candidate.id === "bank_intent");
    const banks = method?.banks ?? [];
    void Promise.all(banks.map(async (bank) => ({ swift: bank.swift, installed: await isInstalled(bank) }))).then((checks) => setInstalledSwifts(new Set(checks.filter((check) => check.installed).map((check) => check.swift))));
    void isEsewaInstalled().then(setEsewaInstalled);
  }, [session?.session_id]);

  function subscribeToFonepay(next: FonepayAction) {
    closeSse();
    const stream = new EventSource<"qr.scanned" | "qr.paid" | "qr.expired">(next.events_url, { headers: { Authorization: `Bearer ${publishableKey}`, "X-PayBridge-Client-Secret": session!.client_secret } });
    stream.addEventListener("qr.scanned", () => {
      if (currentQr.current === next.qr_message) {
        scannedQr.current = next.qr_message;
        setFonepayPhase("scanned");
      }
    });
    stream.addEventListener("qr.paid", () => { void reportStatusAndRecover(); });
    stream.addEventListener("qr.expired", () => {
      if (currentQr.current !== next.qr_message) return;
      if (scannedQr.current === next.qr_message) {
        void reportStatusAndRecover();
        return;
      }
      setFonepayPhase("expired");
    });
    stream.addEventListener("error", () => { /* AppState resume and explicit status reads cover background/reconnect gaps. */ });
    source.current = stream;
  }

  async function showAction(next: MobileAction, method: MobileMethod, launchProvider: boolean) {
    if (!session) return;
    setConfirmation({ sessionId: session.session_id, method: method.id });
    setAction(next);
    if (next.provider === "fonepay") {
      currentQr.current = next.qr_message;
      scannedQr.current = null;
      currentFonepay.current = next;
      lastAutoRefreshQr.current = null;
      setFonepayPhase("waiting");
      subscribeToFonepay(next);
      if (method.id === "bank_intent") {
        const installedBanks = fonepayBanks(session.methods, next).filter((bank) => installedSwifts.has(bank.swift));
        setBankPicker(true);
        if (launchProvider && bankAppBehavior(installedBanks.length) === "direct") await openBank(installedBanks[0]!);
      }
      return;
    }
    currentQr.current = null;
    currentFonepay.current = null;
    if (next.provider !== "esewa") return;
    const intentUrl = String(next.native_params.intent_url ?? "");
    if (method.id !== "esewa" || !method.esewa_intent_eligible || !intentUrl) return;
    if (launchProvider) await openEsewaIntent(intentUrl);
    else {
      setIntentLaunched(true);
      setExternalReturned(true);
      setIntentPhase("returned");
    }
  }

  async function choose(method: MobileMethod) {
    if (!client || !session || seconds <= 0) return;
    setBusy(method.id); setError(null); setExternalReturned(false);
    try {
      const devicePlatform = Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : undefined;
      const installed = method.id === "esewa" && esewaInstalled === null ? await isEsewaInstalled() : esewaInstalled;
      if (method.id === "esewa" && esewaInstalled === null) setEsewaInstalled(installed);
      const platform = method.id === "esewa" && (!installed || !returnUrl) ? undefined : devicePlatform;
      const response = await client.confirm(method.id, platform, platform && method.id === "esewa" ? returnUrl : undefined);
      await showAction(response.action, method, true);
    } catch (cause) { const message = (cause as Error).message; setError(customerFacingPaymentError(message)); onError(cause as Error); }
    finally { setBusy(null); }
  }

  async function restoreActiveSession() {
    if (!client || !session) return;
    setBusy("restore");
    try {
      const status = await client.status();
      if ((status.status === "success" || status.status === "expired") && !terminalReported.current) {
        terminalReported.current = true;
        onComplete({ status: status.status, sessionId: session.session_id, provider: status.provider });
        return;
      }
      if (status.status !== "initiated" || !status.active_method) return;
      const method = session.methods.find((candidate) => candidate.id === status.active_method);
      if (!method) throw new Error("The active payment method is no longer available in this session.");
      const devicePlatform = Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : undefined;
      const platform = method.id === "esewa" && returnUrl ? devicePlatform : undefined;
      const response = await client.confirm(method.id, platform, platform && method.id === "esewa" ? returnUrl : undefined);
      await showAction(response.action, method, false);
    } catch (cause) {
      const message = (cause as Error).message;
      setError(customerFacingPaymentError(message));
      onError(cause as Error);
    } finally {
      setBusy(null);
    }
  }

  async function openBank(bank: Bank & { url?: string }) {
    if (!bank.url) { setError(`${bank.name} cannot be opened right now.`); return; }
    setSelectedBank(bank);
    setBankQrVisible(false);
    setError(null);
    bankAppOpen.current = true;
    try { await Linking.openURL(bank.url); }
    catch {
      bankAppOpen.current = false;
      setSelectedBank(null);
      setError(`${bank.name} could not open. Install or update the bank app, or choose another payment method.`);
    }
  }

  async function openEsewaIntent(
    intentUrl = action?.provider === "esewa" ? String(action.native_params.intent_url ?? "") : "",
  ) {
    if (!intentUrl) { setIntentPhase("unavailable"); return; }
    const openUrl = Platform.OS === "android" ? esewaAndroidOpenUrl(intentUrl, session?.mode) : intentUrl;
    if (!openUrl) { setIntentPhase("unavailable"); return; }
    intentAppOpen.current = true;
    setIntentLaunched(true);
    setIntentPhase("opening");
    try { await Linking.openURL(openUrl); }
    catch {
      intentAppOpen.current = false;
      setIntentPhase("unavailable");
    }
  }

  async function refreshFonepayQr(current: FonepayAction) {
    if (!client || !session || currentQr.current !== current.qr_message || qrRefreshing.current) return;
    qrRefreshing.current = true;
    setBusy("refresh-qr"); setError(null); setFonepayPhase("refreshing");
    try {
      const response = await client.refreshQr();
      currentQr.current = response.action.qr_message;
      scannedQr.current = null;
      currentFonepay.current = response.action;
      lastAutoRefreshQr.current = null;
      setAction(response.action);
      setSelectedBank((bank) => bank
        ? fonepayBanks(session.methods, response.action).find((candidate) => candidate.swift === bank.swift) ?? bank
        : null);
      setFonepayPhase("waiting");
      subscribeToFonepay(response.action);
    } catch (cause) {
      const status = await reportStatus();
      if (status === "success" || status === "expired") return;
      setFonepayPhase("expired");
      const message = (cause as Error).message;
      setError(customerFacingPaymentError(message));
      onError(cause as Error);
    } finally {
      qrRefreshing.current = false;
      setBusy(null);
    }
  }

  async function chooseAnotherMethod() {
    if (!client || !session || busy === "change-method") return;
    if (returnRecheck.current) clearTimeout(returnRecheck.current);
    returnRecheck.current = null;
    const previousQr = currentQr.current;
    currentQr.current = null;
    setBusy("change-method"); setError(null);
    try {
      const status = await client.changeMethod();
      if ((status.status === "success" || status.status === "expired") && !terminalReported.current) {
        terminalReported.current = true;
        closeSse();
        onComplete({ status: status.status, sessionId: session.session_id, provider: status.provider });
        return;
      }
      closeSse();
      setAction(null);
      currentFonepay.current = null;
      setConfirmation(null);
      setBankPicker(false);
      setSelectedBank(null);
      setBankChecking(false);
      setBankQrVisible(false);
      setIntentLaunched(false);
      setIntentPhase("idle");
      setExternalReturned(false);
      intentAppOpen.current = false;
      bankAppOpen.current = false;
      setFonepayPhase("waiting");
      lastAutoRefreshQr.current = null;
    } catch (cause) {
      currentQr.current = previousQr;
      const message = (cause as Error).message;
      setError(customerFacingPaymentError(message));
      if (cause instanceof PaymentSheetRequestError && cause.code === "method_change_not_safe") {
        setExternalReturned(true);
        setIntentPhase("returned");
      } else onError(cause as Error);
    } finally {
      setBusy(null);
    }
  }

  async function reportStatusAndRecover() {
    const status = await reportStatus();
    if (status === "failed" || status === "cancelled") await chooseAnotherMethod();
    return status;
  }

  async function shareFonepayQr(qr: FonepayAction) {
    const image = qr.share_image ?? qr.qr_image;
    if (!image || !session || qrSharing.current) return;
    if (!NativeModules.RNShare) {
      setError("QR sharing needs a development build. Expo Go does not include the native share module.");
      return;
    }
    qrSharing.current = true;
    setError(null);
    try {
      const Share = (await import("react-native-share")).default;
      await Share.open({
        url: image,
        type: "image/png",
        filename: "fonepay-qr",
        message: `Pay ${formatAmount(session.amount)} to ${merchantName} with Fonepay`,
        useInternalStorage: true,
        failOnCancel: false,
      });
    } catch (cause) {
      console.error("[PayBridgeNP] QR share failed", cause);
      setError("The QR could not be shared. Try again.");
    } finally {
      qrSharing.current = false;
    }
  }

  function confirmSheetExit() {
    if (Platform.OS === "ios") {
      const name = action?.provider === "khalti" ? "Khalti" : action?.provider === "esewa" ? "eSewa" : action?.provider === "fonepay" ? "Fonepay" : null;
      Alert.alert(
        name ? `Leave ${name} checkout?` : "Close payment sheet?",
        action
          ? "Your payment may still be active. PayBridgeNP will keep checking it safely after you leave."
          : "You can reopen the payment sheet if you still want to pay.",
        [
          { text: "Keep paying", style: "cancel" },
          { text: "Leave checkout", style: "destructive", onPress: onCancel },
        ],
      );
      return;
    }
    setExitConfirmation(true);
  }

  if (!session) return null;
  const fonepay = action?.provider === "fonepay" ? action : null;
  const fonepayQr = fonepay?.type === "fonepay_qr" ? fonepay : null;
  const external = action?.type === "native_sdk" && !intentLaunched && !externalReturned ? action as NativeSdkAction : null;
  const banks = fonepay ? orderBanks(fonepayBanks(session.methods, fonepay), installedSwifts).filter((bank) => bank.installed) : [];
  const bankMethod = session.methods.find((method): method is Extract<MobileMethod, { id: "bank_intent" }> => method.id === "bank_intent");
  const installedBanks = bankMethod ? orderBanks(bankMethod.banks, installedSwifts).filter((bank) => bank.installed) : [];
  const singleInstalledBank = installedBanks.length === 1 ? installedBanks[0] : null;
  const confirmedMethod = confirmation?.sessionId === session.session_id ? confirmation.method : null;
  const methods = paymentSheetMethods(session.methods, confirmedMethod).filter((method) => method.id !== "bank_intent" || installedSwifts.size > 0);
  const visibleQr = fonepayQr ?? (bankQrVisible ? fonepay : null);
  const fonepayMethod = session.methods.find((method) => method.provider === "fonepay");
  const visibleQrSeconds = visibleQr && session ? payableSeconds(visibleQr.expires_at, session.expires_at) : 0;
  // The picker hugs its content (two methods should not sit above 200pt of
  // empty sheet — seen on device 2026-08-21). States that draw a QR or an
  // in-flight spinner keep a floor so the sheet does not jump around while
  // the QR, scanned state and countdown swap in and out.
  const needsFloor = !!visibleQr || intentPhase !== "idle";
  const dynamic = { backgroundColor: colors.background, borderTopLeftRadius: appearance?.radius ?? 20, borderTopRightRadius: appearance?.radius ?? 20, minHeight: needsFloor ? 380 : undefined };
  const providerName = action?.provider === "khalti" ? "Khalti" : action?.provider === "esewa" ? "eSewa" : "payment app";
  const isEsewaIntentAction = action?.provider === "esewa" && intentLaunched;
  const exitProviderName = action?.provider === "khalti" ? "Khalti" : action?.provider === "esewa" ? "eSewa" : action?.provider === "fonepay" ? "Fonepay" : null;
  const testModeBadge = session.mode === "sandbox" ? <View accessibilityLabel="Test mode" style={styles.testMode}><Text style={styles.testModeText}>TEST MODE</Text></View> : null;

  const qrStatus = fonepayPhase === "scanned"
    ? "QR scanned. Approve the payment in your bank app."
    : fonepayPhase === "refreshing"
      ? "Generating a fresh QR…"
      : fonepayPhase === "expired"
        ? "QR expired"
        : "Waiting for scan…";

  const qrPanel = visibleQr ? <ScrollView style={styles.qrScroll} contentContainerStyle={styles.qrArea} showsVerticalScrollIndicator={false}>{fonepayMethod ? <View style={styles.qrProvider}><MethodLogo method={fonepayMethod} colors={colors} apiBaseUrl={config?.baseUrl} /><Text style={[styles.qrProviderName, { color: colors.text }]}>Fonepay QR</Text></View> : null}<NativeQr value={visibleQr.qr_message} color={colors.text} backgroundColor={colors.surface} /><Text accessibilityLiveRegion="polite" style={[styles.status, { color: fonepayPhase === "scanned" ? colors.primary : colors.mutedText }]}>{qrStatus}</Text><Text style={[styles.hint, { color: colors.mutedText }]}>{visibleQrSeconds > 0 ? `QR expires in ${formatCountdown(visibleQrSeconds)}` : "This code can no longer be shown as payable."}</Text>{(visibleQr.share_image || visibleQr.qr_image) && visibleQrSeconds > 0 ? <TouchableOpacity accessibilityRole="button" style={[styles.primaryButton, { backgroundColor: colors.primary, borderRadius: appearance?.radius ?? 12 }]} onPress={() => void shareFonepayQr(visibleQr)}><Text style={{ color: colors.primaryText, fontWeight: "700" }}>Share QR</Text></TouchableOpacity> : null}{fonepayPhase === "expired" ? <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: busy === "refresh-qr", busy: busy === "refresh-qr" }} disabled={busy === "refresh-qr"} style={[styles.primaryButton, { backgroundColor: colors.primary, borderRadius: appearance?.radius ?? 12 }]} onPress={() => void refreshFonepayQr(visibleQr)}><Text style={{ color: colors.primaryText, fontWeight: "700" }}>{busy === "refresh-qr" ? "Refreshing…" : "Try a fresh QR"}</Text></TouchableOpacity> : null}<TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: !!busy }} disabled={!!busy} style={[styles.other, { borderColor: colors.primary, borderRadius: appearance?.radius ?? 12 }]} onPress={bankQrVisible ? () => setBankQrVisible(false) : () => void chooseAnotherMethod()}><Text style={{ color: colors.primary, fontWeight: "700" }}>{bankQrVisible ? `Back to ${selectedBank?.name ?? "bank app"}` : busy === "change-method" ? "Returning…" : "Other payment methods"}</Text></TouchableOpacity></ScrollView> : null;

  return <Modal visible={visible} transparent={!external} animationType="slide" statusBarTranslucent={Platform.OS === "android"} onRequestClose={exitConfirmation ? () => setExitConfirmation(false) : confirmSheetExit}>
    <View style={styles.modalRoot}>{external ? <SafeAreaProvider style={styles.modalRoot}><ExternalPaymentScreen action={external} merchantName={merchantName} amount={session.amount} mode={session.mode} expiresAt={session.expires_at} onReturn={(outcome) => void handleExternalReturn(outcome)} onCancel={confirmSheetExit} colors={colors} radius={appearance?.radius ?? 12} logoUri={(() => { const m = session.methods.find((candidate) => candidate.id === external.provider); return m?.logo ? mobileAssetUrl(m.logo, config?.baseUrl) : null; })()} /></SafeAreaProvider> :
      <View style={styles.backdrop}><SafeAreaView edges={["bottom"]} style={[styles.sheet, dynamic]}>
        {bankPicker ? <><View style={styles.header}><View style={styles.headerCopy}><View style={styles.titleRow}><Text style={[styles.title, { color: colors.text }]}>{bankQrVisible ? "Fonepay QR" : selectedBank ? selectedBank.name : "Choose bank app"}</Text>{testModeBadge}</View><Text style={[styles.amount, { color: colors.mutedText }]}>{bankQrVisible || selectedBank ? `${formatAmount(session.amount)} · ${seconds > 0 ? `${formatCountdown(seconds)} left` : "Expired"}` : `${banks.length} bank app${banks.length === 1 ? "" : "s"} ready`}</Text></View><TouchableOpacity accessibilityRole="button" accessibilityLabel="Other payment methods" accessibilityState={{ disabled: busy === "change-method", busy: busy === "change-method" }} disabled={busy === "change-method"} onPress={() => void chooseAnotherMethod()}><Text style={[styles.cancel, { color: colors.primary }]}>{busy === "change-method" ? "Returning…" : "Methods"}</Text></TouchableOpacity></View>{error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}{bankQrVisible ? qrPanel : selectedBank ? <View style={styles.intentArea}>{bankChecking || fonepayPhase === "scanned" || fonepayPhase === "refreshing" ? <ActivityIndicator color={colors.primary} /> : <BankLogo bank={selectedBank} colors={colors} apiBaseUrl={config?.baseUrl} />}<Text accessibilityLiveRegion="polite" style={[styles.status, { color: colors.text }]}>{bankChecking ? "Checking payment…" : fonepayPhase === "scanned" ? "Payment detected — confirming…" : fonepayPhase === "refreshing" ? "Refreshing payment request…" : fonepayPhase === "expired" ? `${selectedBank.name} request expired` : `Approve in ${selectedBank.name}`}</Text><Text style={[styles.hint, { color: colors.mutedText }]}>{fonepayPhase === "scanned" ? "This usually takes a few seconds." : fonepayPhase === "refreshing" ? "This takes a moment." : fonepayPhase === "expired" ? `Refresh the request before reopening ${selectedBank.name}.` : `Finish the payment in ${selectedBank.name}. Request refreshes in ${fonepay ? formatCountdown(payableSeconds(fonepay.expires_at, session.expires_at)) : "0:00"}.`}</Text><TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: !!busy }} disabled={!!busy} style={[styles.primaryButton, { backgroundColor: colors.primary, borderRadius: appearance?.radius ?? 12 }]} onPress={fonepayPhase === "expired" && fonepay ? () => void refreshFonepayQr(fonepay) : () => void openBank(selectedBank)}><Text style={{ color: colors.primaryText, fontWeight: "700" }}>{fonepayPhase === "expired" ? "Refresh request" : `Open ${selectedBank.name}`}</Text></TouchableOpacity>{fonepay?.qr_image ? <TouchableOpacity accessibilityRole="button" style={styles.secondaryAction} onPress={() => setBankQrVisible(true)}><Text style={{ color: colors.primary, fontWeight: "700" }}>Use Fonepay QR instead</Text></TouchableOpacity> : null}</View> : <ScrollView><View style={[styles.bankList, { backgroundColor: colors.surface, borderColor: colors.border }]}>{banks.map((bank, index) => <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${bank.name}. Open bank app`} key={bank.swift} testID={`bank-${bank.swift}`} onPress={() => void openBank(bank)} style={[styles.bank, { borderBottomColor: colors.border }, index === banks.length - 1 && styles.bankLast]}><BankLogo bank={bank} colors={colors} apiBaseUrl={config?.baseUrl} /><Text style={[styles.bankName, { color: colors.text }]}>{bank.name}</Text><Text style={[styles.chevron, { color: colors.mutedText }]}>›</Text></TouchableOpacity>)}</View></ScrollView>}</> : <>
        <View style={styles.header}><View style={styles.headerCopy}><View style={styles.titleRow}><Text style={[styles.title, { color: colors.text, fontFamily: appearance?.fonts?.headingFamily ?? appearance?.fonts?.family }]}>Pay {merchantName}</Text>{testModeBadge}</View><Text style={[styles.amount, { color: colors.mutedText }]}>{formatAmount(session.amount)} · {seconds > 0 ? `${formatCountdown(seconds)} left` : "Expired"}</Text></View><TouchableOpacity accessibilityRole="button" accessibilityLabel="Close payment" hitSlop={8} style={styles.headerAction} onPress={confirmSheetExit}><Text style={[styles.closeIcon, { color: colors.text }]}>×</Text></TouchableOpacity></View>
        {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
        {intentPhase !== "idle" ? <View style={styles.intentArea}>{intentPhase === "opening" || intentPhase === "checking" || intentPhase === "cancelling" ? <ActivityIndicator color={colors.primary} /> : null}<Text style={[styles.status, { color: colors.text }]}>{intentPhase === "opening" ? "Opening eSewa…" : intentPhase === "checking" ? "Checking payment…" : intentPhase === "cancelling" ? "Confirming cancellation…" : intentPhase === "returned" ? `${providerName} payment still active` : `Could not open ${providerName}`}</Text><Text style={[styles.hint, { color: colors.mutedText }]}>{intentPhase === "returned" ? `We can’t safely show another method until ${providerName} confirms this payment was cancelled or not completed. We’ll let you switch as soon as ${providerName} responds. You can also close this and start the payment again.` : intentPhase === "unavailable" ? `Try ${providerName} again, or choose another payment method.` : intentPhase === "cancelling" ? "We’ll return to payment methods as soon as the provider confirms the cancellation." : `Return here after completing or cancelling in ${providerName}.`}</Text>{intentPhase === "returned" || intentPhase === "unavailable" ? <TouchableOpacity accessibilityRole="button" style={[styles.primaryButton, { backgroundColor: colors.primary, borderRadius: appearance?.radius ?? 12 }]} onPress={isEsewaIntentAction ? () => void openEsewaIntent() : () => void handleExternalReturn()}><Text style={{ color: colors.primaryText, fontWeight: "700" }}>{isEsewaIntentAction ? "Continue in eSewa" : "Check payment status"}</Text></TouchableOpacity> : null}{intentPhase === "returned" || intentPhase === "unavailable" ? <TouchableOpacity accessibilityRole="button" hitSlop={8} disabled={!!busy} style={styles.secondaryAction} onPress={() => void chooseAnotherMethod()}><Text style={{ color: colors.primary, fontWeight: "700" }}>{busy === "change-method" ? "Checking availability…" : "Choose another method"}</Text></TouchableOpacity> : null}</View> : fonepayQr ? qrPanel : <ScrollView>{busy === "restore" ? <View style={styles.restoreRow}><ActivityIndicator color={colors.primary} /><Text style={[styles.restoreText, { color: colors.mutedText }]}>Checking this payment… if it is already open with a provider, it will continue there.</Text></View> : null}{methods.map((method) => { const bank = method.id === "bank_intent" ? singleInstalledBank : null; return <TouchableOpacity accessibilityRole="button" key={method.id} testID={`payment-method-${method.id}`} disabled={!!busy || seconds <= 0} onPress={() => void choose(method)} style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: appearance?.radius ?? 12 }]}><View style={styles.methodInfo}>{bank ? <BankLogo bank={bank} colors={colors} apiBaseUrl={config?.baseUrl} /> : <MethodLogo method={method} colors={colors} apiBaseUrl={config?.baseUrl} />}<View style={styles.methodText}><Text style={[styles.rowLabel, { color: colors.text, fontFamily: appearance?.fonts?.family }]}>{bank?.name ?? method.label}</Text><Text style={[styles.rowSub, { color: colors.mutedText }]}>{bank ? `Pay with the ${bank.name} app` : method.id === "bank_intent" ? "Choose your mobile banking app" : method.id === "fonepay_qr" ? "Scan or share a Fonepay QR" : method.id === "esewa" ? "eSewa app or secure checkout" : "Khalti secure checkout"}</Text></View></View><Text style={{ color: colors.primary }}>{busy === method.id ? "Opening…" : "›"}</Text></TouchableOpacity>; })}<Text style={[styles.footer, { color: colors.mutedText }]}>Secured by PayBridgeNP</Text></ScrollView>}</>}
      </SafeAreaView></View>
    }{exitConfirmation ? <View accessibilityViewIsModal style={styles.exitBackdrop}><View style={[styles.exitCard, { backgroundColor: colors.surface }]}><Text style={[styles.exitTitle, { color: colors.text }]}>{exitProviderName ? `Leave ${exitProviderName} checkout?` : "Close payment sheet?"}</Text><Text style={[styles.exitMessage, { color: colors.mutedText }]}>{action ? "Your payment may still be active. PayBridgeNP will keep checking it safely after you leave." : "You can reopen the payment sheet if you still want to pay."}</Text><TouchableOpacity accessibilityRole="button" style={[styles.primaryButton, { backgroundColor: colors.primary, borderRadius: appearance?.radius ?? 12 }]} onPress={() => setExitConfirmation(false)}><Text style={{ color: colors.primaryText, fontWeight: "700" }}>Keep paying</Text></TouchableOpacity><TouchableOpacity accessibilityRole="button" style={[styles.other, { borderColor: colors.border, borderRadius: appearance?.radius ?? 12 }]} onPress={() => { setExitConfirmation(false); onCancel(); }}><Text style={{ color: colors.danger, fontWeight: "700" }}>Leave checkout</Text></TouchableOpacity></View></View> : null}</View>
  </Modal>;
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1 },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,.42)" },
  sheet: { maxHeight: "86%", paddingHorizontal: 18, paddingBottom: 12 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 14, paddingBottom: 10 },
  headerCopy: { flex: 1, paddingRight: 12 },
  headerAction: { minWidth: 44, minHeight: 44, alignItems: "flex-end", justifyContent: "center" },
  titleRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  title: { flexShrink: 1, fontWeight: "700", fontSize: 18 },
  testMode: { borderRadius: 999, backgroundColor: "#FEF3C7", paddingHorizontal: 7, paddingVertical: 3 },
  testModeText: { color: "#92400E", fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  amount: { marginTop: 3 },
  cancel: { fontWeight: "700" },
  closeIcon: { fontSize: 28, lineHeight: 30, fontWeight: "400" },
  error: { marginBottom: 8 },
  row: { minHeight: Platform.OS === "android" ? 52 : 64, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: Platform.OS === "android" ? 6 : 11, marginVertical: Platform.OS === "android" ? 3 : 4, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  methodInfo: { flex: 1, flexDirection: "row", alignItems: "center", gap: Platform.OS === "android" ? 10 : 12 },
  methodText: { flex: 1 },
  rowLabel: { fontSize: 16, fontWeight: "700" },
  rowSub: { marginTop: 2, fontSize: Platform.OS === "android" ? 13 : undefined, lineHeight: Platform.OS === "android" ? 17 : undefined },
  footer: { fontSize: 12, textAlign: "center", paddingVertical: 10 },
  restoreRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 2, marginBottom: 4 },
  restoreText: { flex: 1, fontSize: 12.5, lineHeight: 17 },
  qrScroll: { flexShrink: 1 },
  qrArea: { alignItems: "center", gap: 12, paddingVertical: 12 },
  qrProvider: { flexDirection: "row", alignItems: "center", gap: 10 },
  qrProviderName: { fontSize: 16, fontWeight: "700" },
  intentArea: { flexGrow: 1, justifyContent: "center", alignItems: "center", gap: 10, paddingVertical: 24 },
  status: { fontSize: 16, fontWeight: "700", textAlign: "center" },
  hint: { maxWidth: 340, fontSize: 14, lineHeight: 20, textAlign: "center" },
  primaryButton: { width: "100%", minHeight: 48, paddingHorizontal: 18, alignItems: "center", justifyContent: "center" },
  secondaryAction: { minHeight: 44, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  bankList: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, overflow: "hidden", marginTop: 4, marginBottom: 8 },
  bank: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  bankLast: { borderBottomWidth: 0 },
  bankName: { flex: 1, fontSize: 16, fontWeight: "600" },
  chevron: { fontSize: 24, lineHeight: 28 },
  logoTile: { width: Platform.OS === "android" ? 34 : 40, height: Platform.OS === "android" ? 34 : 40, borderRadius: Platform.OS === "android" ? 9 : 10, padding: 5, backgroundColor: "#FFFFFF", borderWidth: StyleSheet.hairlineWidth, justifyContent: "center", alignItems: "center" },
  logo: { width: "100%", height: "100%" },
  other: { width: "100%", minHeight: 48, marginTop: 4, paddingHorizontal: 16, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  exitBackdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 20, justifyContent: "flex-end", padding: 18, backgroundColor: "rgba(0,0,0,.52)" },
  exitCard: { borderRadius: 20, padding: 20, gap: 12 },
  exitTitle: { fontSize: 20, fontWeight: "700" },
  exitMessage: { fontSize: 14, lineHeight: 20, marginBottom: 4 },
});
