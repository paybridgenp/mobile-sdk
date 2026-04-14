// ---------------------------------------------------------------------------
// EsewaWebView — eSewa ePay v2 payment via managed WebView
// ---------------------------------------------------------------------------
// Renders an HTML form with the pre-signed eSewa fields (from native_params),
// auto-submits it to eSewa's ePay v2 endpoint, then intercepts the redirect
// back to success_url or failure_url to extract the payment result.
//
// Peer dep: react-native-webview
//   npm install react-native-webview
//   expo run:android / expo run:ios (to rebuild with native module)
// ---------------------------------------------------------------------------

import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import WebView from "react-native-webview";
import type { WebViewNavigation } from "react-native-webview";
import type { NativeParams } from "../types/native";

type Props = {
  visible: boolean;
  native_params: NativeParams;
  onSuccess: (base64Data: string) => void;
  onFailure: (message: string) => void;
  onCancel: () => void;
};

// Locks viewport to prevent pinch-to-zoom. Injected before content loads and
// watches for the page trying to re-enable zoom via MutationObserver.
const NO_ZOOM_JS = `(function(){
  function lockViewport(){
    var m=document.querySelector('meta[name="viewport"]');
    if(!m){m=document.createElement('meta');m.name='viewport';document.head.appendChild(m);}
    m.content='width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no';
  }
  lockViewport();
  new MutationObserver(lockViewport).observe(document.head,{childList:true,subtree:true,attributes:true,attributeFilter:['content']});
})(); true;`;

// Build an HTML page that auto-submits the eSewa form on load
function buildFormHtml(params: NativeParams): string {
  const FIELDS = [
    "amount",
    "tax_amount",
    "total_amount",
    "transaction_uuid",
    "product_code",
    "product_service_charge",
    "product_delivery_charge",
    "success_url",
    "failure_url",
    "signed_field_names",
    "signature",
  ];

  const inputs = FIELDS.map(
    (f) => `<input type="hidden" name="${f}" value="${escapeHtml(String(params[f] ?? ""))}" />`,
  ).join("\n    ");

  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <style>
    body { font-family: -apple-system, sans-serif; display: flex; align-items: center;
           justify-content: center; min-height: 100vh; margin: 0; background: #F5F5F5; }
    p { color: #60BB46; font-size: 16px; font-weight: 600; }
  </style>
</head>
<body onload="document.forms[0].submit()">
  <form method="POST" action="${escapeHtml(String(params.form_url ?? ""))}">
    ${inputs}
  </form>
  <p>Redirecting to eSewa...</p>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Extract ?data= from a URL string without relying on the global URL constructor
function extractDataParam(url: string): string | null {
  const match = url.match(/[?&]data=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function EsewaWebView({ visible, native_params, onSuccess, onFailure, onCancel }: Props) {
  const [loading, setLoading] = useState(true);
  const handled = useRef(false);

  const successBase = String(native_params.success_url ?? "");
  const failureBase = String(native_params.failure_url ?? "");

  function handleNavigationChange(nav: WebViewNavigation) {
    if (handled.current) return false;

    const url = nav.url;

    // eSewa redirects to success_url?data=<base64> on success
    if (successBase && url.startsWith(successBase)) {
      const data = extractDataParam(url);
      if (data) {
        handled.current = true;
        onSuccess(data);
        return false; // block navigation
      }
      // success_url hit but no data — treat as failure
      handled.current = true;
      onFailure("eSewa returned no transaction data");
      return false;
    }

    // eSewa redirects to failure_url on failure / cancellation
    if (failureBase && url.startsWith(failureBase)) {
      handled.current = true;
      onFailure("eSewa payment was not completed");
      return false;
    }

    return true; // allow navigation
  }

  const formHtml = buildFormHtml(native_params);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onCancel}
      statusBarTranslucent={Platform.OS === "android"}
    >
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.dot} />
            <Text style={styles.title}>eSewa</Text>
          </View>
          <TouchableOpacity
            onPress={onCancel}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={styles.cancelBtn}>Cancel</Text>
          </TouchableOpacity>
        </View>

        {/* Loading overlay */}
        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#60BB46" />
            <Text style={styles.loadingText}>Loading eSewa...</Text>
          </View>
        )}

        <WebView
          source={{ html: formHtml }}
          onShouldStartLoadWithRequest={handleNavigationChange}
          onLoadEnd={() => setLoading(false)}
          onError={() => {
            if (!handled.current) {
              handled.current = true;
              onFailure("Failed to load eSewa payment page. Check your internet connection.");
            }
          }}
          javaScriptEnabled
          domStorageEnabled
          scalesPageToFit={false}
          injectedJavaScriptBeforeContentLoaded={NO_ZOOM_JS}
          injectedJavaScript={NO_ZOOM_JS}
          style={styles.webview}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E8E8E8",
    backgroundColor: "#fff",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#60BB46",
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: "#111",
  },
  cancelBtn: {
    fontSize: 15,
    color: "#007AFF",
    fontWeight: "500",
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: "#60BB46",
    fontWeight: "500",
  },
  webview: {
    flex: 1,
  },
});
