import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
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
export function ExternalPaymentScreen({ action, merchantName, amount, mode, expiresAt, onReturn, onCancel }: Props) {
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(() => secondsUntil(expiresAt));
  const webKey = useRef(0);
  const handledReturn = useRef(false);
  const loadTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const webView = useRef<WebViewHandle>(null);
  const params = action.native_params;
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
    return () => {
      clearInterval(timer);
      if (loadTimeout.current) clearTimeout(loadTimeout.current);
    };
  }, [expiresAt, action]);

  function startLoading() {
    if (loadTimeout.current) clearTimeout(loadTimeout.current);
    setLoading(true);
    setProblem(null);
    loadTimeout.current = setTimeout(() => {
      setLoading(false);
      setProblem("The payment page is taking too long. Check your connection and retry.");
    }, 45_000);
  }

  function finishLoading() {
    if (loadTimeout.current) clearTimeout(loadTimeout.current);
    loadTimeout.current = null;
    setLoading(false);
  }

  function retry() {
    if (action.provider === "esewa") { onReturn("returned"); return; }
    webKey.current += 1;
    setLoading(true);
    setProblem(null);
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
    <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <View><View style={styles.titleRow}><Text style={styles.merchant}>{merchantName}</Text>{mode === "sandbox" ? <View accessibilityLabel="Test mode" style={styles.testMode}><Text style={styles.testModeText}>TEST MODE</Text></View> : null}</View><Text style={styles.amount}>{formatAmount(amount)} · {seconds > 0 ? `${formatCountdown(seconds)} left` : "Expired"}</Text></View>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close payment" hitSlop={8} style={styles.headerAction} onPress={onCancel}><Text style={styles.closeIcon}>×</Text></TouchableOpacity>
        </View>
        <View style={styles.body}>
        {problem ? <View style={styles.problem}><Text accessibilityRole="alert" style={styles.problemText}>{problem}</Text><TouchableOpacity accessibilityRole="button" onPress={retry}><Text style={styles.retry}>{action.provider === "esewa" ? "Check status" : "Retry"}</Text></TouchableOpacity></View> : null}
        {loading && !problem ? <View accessibilityLiveRegion="polite" style={styles.loading}><ActivityIndicator size="large" color="#1459D9" /><Text>Opening secure payment…</Text></View> : null}
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
            if (!handledReturn.current) setProblem("Could not load the payment page. Check your connection and retry.");
          }}
          javaScriptEnabled domStorageEnabled style={styles.webview}
        />
        </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" }, header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: "#e5e7eb" }, headerAction: { minWidth: 44, minHeight: 44, alignItems: "flex-end", justifyContent: "center" }, titleRow: { flexDirection: "row", alignItems: "center", gap: 8 }, merchant: { fontWeight: "700", fontSize: 16, color: "#111827" }, testMode: { borderRadius: 999, backgroundColor: "#FEF3C7", paddingHorizontal: 7, paddingVertical: 3 }, testModeText: { color: "#92400E", fontSize: 10, fontWeight: "800", letterSpacing: 0.5 }, amount: { color: "#6b7280", marginTop: 3 }, closeIcon: { color: "#111827", fontSize: 28, lineHeight: 30, fontWeight: "400" }, body: { flex: 1 }, webview: { flex: 1 }, loading: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 2, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: "#fff" }, problem: { padding: 14, backgroundColor: "#fff7ed", flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, problemText: { flex: 1, color: "#9a3412" }, retry: { color: "#1459D9", fontWeight: "700", marginLeft: 12 },
});
