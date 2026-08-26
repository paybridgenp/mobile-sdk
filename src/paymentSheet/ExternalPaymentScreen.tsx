import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import WebViewComponent from "react-native-webview";
import type { WebViewNavigation, WebViewProps } from "react-native-webview";
import { externalCallbackUrls, externalReturnOutcome, formatAmount, formatCountdown, isAllowedExternalNavigation, isInlineFormDocument, secondsUntil } from "./utils";
import type { NativeSdkAction } from "./types";

type Props = {
  action: NativeSdkAction;
  merchantName: string;
  amount: number;
  mode?: "sandbox" | "live";
  expiresAt: string;
  onReturn: (outcome: "cancelled" | "returned") => void;
  onCancel: () => void;
  /** Sheet theme, so this screen reads as part of the same product. */
  colors?: { background: string; surface: string; text: string; mutedText: string; primary: string; primaryText: string; border: string; danger: string };
  radius?: number;
  /** Absolute URL of the provider logo, for the not-responding state. */
  logoUri?: string | null;
};

type WebViewHandle = { injectJavaScript: (script: string) => void };
const WebView = WebViewComponent as unknown as React.ComponentType<WebViewProps & React.RefAttributes<WebViewHandle>>;

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function esewaHtml(params: Record<string, string | number>): string {
  const fields = ["amount", "tax_amount", "total_amount", "transaction_uuid", "product_code", "product_service_charge", "product_delivery_charge", "success_url", "failure_url", "signed_field_names", "signature"];
  return `<html><body onload="document.forms[0].submit()"><form method="POST" action="${escapeHtml(String(params.form_url ?? ""))}">${fields.map((key) => `<input type="hidden" name="${key}" value="${escapeHtml(String(params[key] ?? ""))}"/>`).join("")}</form></body></html>`;
}

function origin(value: string): string | null {
  return value.match(/^(https?:\/\/[^/?#]+)/i)?.[1].toLowerCase() ?? null;
}

const IOS_INPUT_ZOOM_FIX = `(function(){
  function fix(){
    document.querySelectorAll('input,select,textarea').forEach(function(el){el.style.setProperty('font-size','16px','important')})
    document.querySelectorAll('.MuiOtpInput-TextField input').forEach(function(el){el.setAttribute('type','tel');el.setAttribute('inputmode','numeric')})
  }
  fix();
  if(!window.__paybridgeIosInputFix){window.__paybridgeIosInputFix=true;new MutationObserver(fix).observe(document.documentElement,{childList:true,subtree:true})}
})();true;`;

/** Provider WebView with a deliberately small navigation allowlist. It reports a return only; server status remains payment proof. */
const DEFAULT_COLORS = { background: "#FFFFFF", surface: "#FFFFFF", text: "#111827", mutedText: "#6B7280", primary: "#1459D9", primaryText: "#FFFFFF", border: "#E5E7EB", danger: "#B91C1C" };

export function ExternalPaymentScreen({ action, merchantName, amount, mode, expiresAt, onReturn, onCancel, colors: themeColors, radius, logoUri }: Props) {
  const colors = themeColors ?? DEFAULT_COLORS;
  const r = radius ?? 12;
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(() => secondsUntil(expiresAt));
  const webKey = useRef(0);
  const handledReturn = useRef(false);
  const loadTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const webView = useRef<WebViewHandle>(null);
  const params = action.native_params;
  const providerLabel = action.provider === "khalti" ? "Khalti" : action.provider === "esewa" ? "eSewa" : "The payment provider";
  const sourceUrl = action.provider === "khalti" ? String(params.payment_url ?? "") : String(params.form_url ?? "");
  const callbackUrls = externalCallbackUrls(params);
  const callbackOrigins = callbackUrls.map(origin).filter((item): item is string => !!item);
  const sourceOrigin = origin(sourceUrl);
  const allowedOrigins = [...new Set([sourceOrigin, ...callbackOrigins].filter((item): item is string => !!item))];

  useEffect(() => {
    handledReturn.current = false;
    setLoading(true);
    setProblem(null);
    const timer = setInterval(() => setSeconds(secondsUntil(expiresAt)), 1_000);
    armDeadline();
    return () => {
      clearInterval(timer);
      if (loadTimeout.current) clearTimeout(loadTimeout.current);
      loadTimeout.current = null;
    };
  }, [expiresAt, action]);

  // One deadline per open (and per explicit retry), armed once. It used to be
  // re-armed on EVERY onLoadStart, and a provider that answers with slow
  // redirects kept pushing it out: a simulator run showed 70s+ of
  // "Opening secure payment..." while a provider sandbox was down.
  const DEADLINE_MS = 30_000;
  function armDeadline() {
    if (loadTimeout.current) clearTimeout(loadTimeout.current);
    loadTimeout.current = setTimeout(() => {
      setLoading(false);
      setProblem("The payment page did not load in time. That is usually the provider or the connection, not your order.");
    }, DEADLINE_MS);
  }
  function startLoading() {
    setLoading(true);
    setProblem(null);
    if (!loadTimeout.current) armDeadline();
  }

  function finishLoading() {
    if (loadTimeout.current) clearTimeout(loadTimeout.current);
    loadTimeout.current = null;
    setLoading(false);
    // A page that arrives after the timeout is still the real payment page:
    // drop the "not responding" state and let the buyer continue.
    setProblem(null);
  }

  function retry() {
    if (action.provider === "esewa") { onReturn("returned"); return; }
    webKey.current += 1;
    setLoading(true);
    setProblem(null);
    armDeadline();
  }

  function handleNavigation(nav: WebViewNavigation) {
    const url = nav.url;
    if (callbackUrls.some((callback) => url.startsWith(callback))) {
      if (!handledReturn.current) { handledReturn.current = true; onReturn(externalReturnOutcome(action.provider, url, params)); }
      return false;
    }
    return isAllowedExternalNavigation(url, allowedOrigins);
  }

  if (!sourceUrl) return null;
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View><View style={styles.titleRow}><Text style={[styles.merchant, { color: colors.text }]}>{merchantName}</Text>{mode === "sandbox" ? <View accessibilityLabel="Test mode" style={styles.testMode}><Text style={styles.testModeText}>TEST MODE</Text></View> : null}</View><Text style={[styles.amount, { color: colors.mutedText }]}>{formatAmount(amount)} · {seconds > 0 ? `${formatCountdown(seconds)} left` : "Expired"}</Text></View>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close payment" hitSlop={8} style={styles.headerAction} onPress={onCancel}><Text style={[styles.closeIcon, { color: colors.text }]}>×</Text></TouchableOpacity>
        </View>
        <View style={styles.body}>
        {problem ? <View accessibilityLiveRegion="polite" style={[styles.problemOverlay, { backgroundColor: colors.background }]}>
          <View style={[styles.problemCard, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: r + 4 }]}>
            <View style={[styles.problemLogo, { borderColor: colors.border, borderRadius: r }]}>{logoUri ? <Image resizeMode="contain" source={{ uri: logoUri }} style={styles.problemLogoImg} /> : <Text style={{ fontWeight: "800", color: colors.text }}>{providerLabel.slice(0, 2).toUpperCase()}</Text>}</View>
            <Text accessibilityRole="header" style={[styles.problemTitle, { color: colors.text }]}>{providerLabel} isn’t responding</Text>
            <Text accessibilityRole="alert" style={[styles.problemText, { color: colors.mutedText }]}>{problem}</Text>
            <TouchableOpacity accessibilityRole="button" style={[styles.problemPrimary, { backgroundColor: colors.primary, borderRadius: r }]} onPress={retry}><Text style={[styles.problemPrimaryText, { color: colors.primaryText }]}>{action.provider === "esewa" ? "Check payment status" : "Try again"}</Text></TouchableOpacity>
            <Text style={[styles.problemHint, { color: colors.mutedText }]}>{action.provider === "esewa"
              ? "eSewa may already have this payment open, so it is not retried from here. If eSewa stays down, close this and start the payment again."
              : "If it keeps failing, close this and choose another way to pay."}</Text>
            <TouchableOpacity accessibilityRole="button" hitSlop={8} style={styles.problemSecondary} onPress={onCancel}><Text style={[styles.problemSecondaryText, { color: colors.primary }]}>Close</Text></TouchableOpacity>
          </View>
        </View> : null}
        {loading && !problem ? <View accessibilityLiveRegion="polite" style={[styles.loading, { backgroundColor: colors.background }]}><ActivityIndicator size="large" color={colors.primary} /><Text style={{ color: colors.mutedText }}>Opening {providerLabel === "The payment provider" ? "secure payment" : providerLabel}…</Text></View> : null}
        <WebView
          ref={webView}
          key={webKey.current}
          source={action.provider === "esewa" ? { html: esewaHtml(params) } : { uri: sourceUrl }}
          onShouldStartLoadWithRequest={handleNavigation}
          onLoadStart={startLoading}
          onLoadEnd={({ nativeEvent }: { nativeEvent: { url: string } }) => {
            if (!isInlineFormDocument(nativeEvent.url)) finishLoading();
            if (Platform.OS === "ios") webView.current?.injectJavaScript(IOS_INPUT_ZOOM_FIX);
          }}
          injectedJavaScriptBeforeContentLoaded={Platform.OS === "ios" ? IOS_INPUT_ZOOM_FIX : undefined}
          injectedJavaScript={Platform.OS === "ios" ? IOS_INPUT_ZOOM_FIX : undefined}
          onError={() => {
            finishLoading();
            if (!handledReturn.current) setProblem("The payment page could not be loaded. Check your connection, or try again in a moment.");
          }}
          javaScriptEnabled domStorageEnabled style={styles.webview}
        />
        </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" }, header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: "#e5e7eb" }, headerAction: { minWidth: 44, minHeight: 44, alignItems: "flex-end", justifyContent: "center" }, titleRow: { flexDirection: "row", alignItems: "center", gap: 8 }, merchant: { fontWeight: "700", fontSize: 16, color: "#111827" }, testMode: { borderRadius: 999, backgroundColor: "#FEF3C7", paddingHorizontal: 7, paddingVertical: 3 }, testModeText: { color: "#92400E", fontSize: 10, fontWeight: "800", letterSpacing: 0.5 }, amount: { color: "#6b7280", marginTop: 3 }, closeIcon: { color: "#111827", fontSize: 28, lineHeight: 30, fontWeight: "400" }, body: { flex: 1 }, webview: { flex: 1 }, loading: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 2, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: "#fff" }, problemOverlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 3, alignItems: "center", justifyContent: "center", padding: 20 }, problemCard: { width: "100%", maxWidth: 400, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 22, paddingVertical: 26, alignItems: "center", gap: 10 }, problemLogo: { width: 56, height: 56, borderWidth: StyleSheet.hairlineWidth, padding: 8, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", marginBottom: 4 }, problemLogoImg: { width: "100%", height: "100%" }, problemTitle: { fontSize: 18, fontWeight: "700", textAlign: "center" }, problemText: { textAlign: "center", lineHeight: 20, fontSize: 14 }, problemPrimary: { marginTop: 8, minHeight: 48, alignSelf: "stretch", paddingHorizontal: 18, alignItems: "center", justifyContent: "center" }, problemPrimaryText: { fontWeight: "700", fontSize: 15 }, problemHint: { fontSize: 12.5, textAlign: "center", lineHeight: 18, marginTop: 2 }, problemSecondary: { minHeight: 44, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" }, problemSecondaryText: { fontWeight: "700" },
});
