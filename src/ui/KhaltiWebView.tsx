// ---------------------------------------------------------------------------
// KhaltiWebView — Khalti ePay v2 payment via managed WebView
// ---------------------------------------------------------------------------
// Opens Khalti's payment_url (from native_params) in a full-screen WebView,
// then intercepts the redirect back to the noop return_url to extract pidx.
//
// Khalti redirects to: <return_url>?pidx=<pidx>&status=Completed|User canceled
//
// Peer dep: react-native-webview
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
  onSuccess: (pidx: string) => void;
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

function extractQueryParam(url: string, key: string): string | null {
  const match = url.match(new RegExp(`[?&]${key}=([^&]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function KhaltiWebView({ visible, native_params, onSuccess, onFailure, onCancel }: Props) {
  const [loading, setLoading] = useState(true);
  const handled = useRef(false);

  const paymentUrl = String(native_params.payment_url ?? "");

  function handleNavigationChange(nav: WebViewNavigation) {
    if (handled.current) return true;

    const url = nav.url;

    // Khalti redirects to return_url with ?pidx=xxx&status=Completed|User canceled
    // Our return_url is the /v1/mobile/noop endpoint — match on that path
    if (url.includes("/v1/mobile/noop") || url.includes("/noop")) {
      const status = extractQueryParam(url, "status");
      const pidx = extractQueryParam(url, "pidx");

      handled.current = true;

      if (status && (status.toLowerCase().includes("cancel") || status.toLowerCase().includes("user"))) {
        onCancel();
        return false;
      }

      if (pidx) {
        onSuccess(pidx);
      } else {
        onFailure("Khalti returned no pidx");
      }
      return false;
    }

    return true;
  }

  if (!paymentUrl) return null;

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
            <Text style={styles.title}>Khalti</Text>
          </View>
          <TouchableOpacity
            onPress={onCancel}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={styles.cancelBtn}>Cancel</Text>
          </TouchableOpacity>
        </View>

        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#5C2D91" />
            <Text style={styles.loadingText}>Loading Khalti...</Text>
          </View>
        )}

        <WebView
          source={{ uri: paymentUrl }}
          onShouldStartLoadWithRequest={handleNavigationChange}
          onLoadEnd={() => setLoading(false)}
          onError={() => {
            if (!handled.current) {
              handled.current = true;
              onFailure("Failed to load Khalti payment page. Check your internet connection.");
            }
          }}
          javaScriptEnabled
          domStorageEnabled
          scalesPageToFit={false}
          injectedJavaScriptBeforeContentLoaded={NO_ZOOM_JS}
          style={styles.webview}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
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
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: "#5C2D91" },
  title: { fontSize: 17, fontWeight: "700", color: "#111" },
  cancelBtn: { fontSize: 15, color: "#007AFF", fontWeight: "500" },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
    gap: 12,
  },
  loadingText: { fontSize: 14, color: "#5C2D91", fontWeight: "500" },
  webview: { flex: 1 },
});
