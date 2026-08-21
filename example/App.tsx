// PayBridgeNP Demo Shop
//
// A tiny store that takes a real (sandbox) payment with the PayBridgeNP
// Payment Sheet. Everything a real app does is here and nothing else:
//
//   1. the buyer builds a cart,
//   2. the app asks YOUR server for one amount-bound payment session
//      (the server holds the sk_ key; the app only ever sees a publishable
//      key and a one-time client secret),
//   3. the sheet shows the payment methods that session allows
//      (Fonepay QR / bank apps, eSewa, Khalti) and runs the payment,
//   4. the app hears success / cancel / error through callbacks.
//
// The "server" for this public demo is PayBridgeNP's own endpoint
// (https://paybridgenp.com/api/demo/mobile-session). Point
// EXPO_PUBLIC_PAYBRIDGE_DEMO_API at your backend to use your own merchant.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { PaymentSheet, usePaymentSheet } from "@paybridge-np/mobile-sdk";
import type { MobilePaymentSession, PaymentSheetResult } from "@paybridge-np/mobile-sdk";

// ── Config ───────────────────────────────────────────────────────────────────

const DEMO_API =
  process.env.EXPO_PUBLIC_PAYBRIDGE_DEMO_API?.trim() || "https://paybridgenp.com/api/demo/mobile-session";
const API_BASE = process.env.EXPO_PUBLIC_PAYBRIDGE_API_BASE?.trim() || "https://api.paybridgenp.com";
const PUBLISHABLE_KEY_ENV = process.env.EXPO_PUBLIC_PAYBRIDGE_PUBLISHABLE_KEY?.trim() || "";
const RETURN_URL = "pbdemo://payment-return";
const ACTIVE_KEY = "pbdemo.activeSession";

// ── Catalog (prices in paisa: NPR 1 = 100 paisa) ─────────────────────────────

type Product = { id: string; name: string; blurb: string; price: number; emoji: string };

const PRODUCTS: Product[] = [
  { id: "tea", name: "Ilam green tea, 100 g", blurb: "First flush, hand rolled", price: 45_000, emoji: "🍵" },
  { id: "topi", name: "Dhaka topi", blurb: "Handloom, Palpa", price: 65_000, emoji: "🧢" },
  { id: "honey", name: "Mad honey, 250 g", blurb: "Wild cliff honey, Lamjung", price: 120_000, emoji: "🍯" },
  { id: "candle", name: "Lokta paper candle set", blurb: "Three scents", price: 28_000, emoji: "🕯️" },
];

function npr(paisa: number): string {
  return `NPR ${(paisa / 100).toLocaleString("en-NP", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Your server call ─────────────────────────────────────────────────────────
// Returns the provider-omitted session from POST /v1/mobile/session, plus (for
// the public demo) the demo merchant's publishable key. A real app would pass
// its own authenticated request here.

type DemoSessionResponse = MobilePaymentSession & { publishable_key?: string };

async function createSessionOnServer(input: {
  amount: number;
  reference: string;
  customer: { name: string; email: string; phone: string };
}): Promise<DemoSessionResponse> {
  const res = await fetch(DEMO_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = (await res.json().catch(() => ({}))) as DemoSessionResponse & { error?: string };
  if (!res.ok) throw new Error(json.error || `Could not start payment (${res.status})`);
  return json;
}

// ── App ──────────────────────────────────────────────────────────────────────

type Order = { reference: string; amount: number; sessionId: string; status: PaymentSheetResult["status"] };

export default function App() {
  return (
    <SafeAreaProvider>
      <Shop />
    </SafeAreaProvider>
  );
}

function Shop() {
  const scheme = useColorScheme();
  const dark = scheme === "dark";
  const c = dark ? palette.dark : palette.light;

  const [qty, setQty] = useState<Record<string, number>>({ tea: 1, topi: 1 });
  const [name, setName] = useState("Asha Rai");
  const [phone, setPhone] = useState("9841000000");
  const [email, setEmail] = useState("asha@example.com");
  const [publishableKey, setPublishableKey] = useState(PUBLISHABLE_KEY_ENV);
  const [lastOrder, setLastOrder] = useState<Order | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const lines = useMemo(
    () => PRODUCTS.filter((p) => (qty[p.id] ?? 0) > 0).map((p) => ({ ...p, qty: qty[p.id] ?? 0 })),
    [qty],
  );
  const total = lines.reduce((sum, l) => sum + l.price * l.qty, 0);

  // One stable reference per cart contents: retrying the same order returns
  // the same session on the server (Idempotency-Key), never a second payable one.
  const reference = useMemo(() => {
    const sig = lines.map((l) => `${l.id}x${l.qty}`).join("_") || "empty";
    return `pbdemo-${sig}-${Math.floor(Date.now() / 60_000).toString(36)}`;
  }, [lines]);

  const { present, resume, loading, paymentSheetProps } = usePaymentSheet({
    fetchSession: async () => {
      const session = await createSessionOnServer({
        amount: total,
        reference,
        customer: { name: name.trim(), email: email.trim(), phone: phone.trim() },
      });
      if (session.publishable_key) setPublishableKey(session.publishable_key);
      // Keep the active session so a killed app can resume the same payment.
      await AsyncStorage.setItem(
        ACTIVE_KEY,
        JSON.stringify({ session, publishableKey: session.publishable_key ?? publishableKey, reference, amount: total }),
      );
      return session;
    },
    publishableKey,
    config: { baseUrl: API_BASE },
    // Needed for eSewa Intent; the same scheme is declared in app.json.
    returnUrl: RETURN_URL,
    appearance: {
      colors: { light: { primary: "#155EEF" }, dark: { primary: "#84ADFF" } },
      radius: 16,
      primaryButton: { backgroundColor: "#155EEF", textColor: "#FFFFFF" },
    },
    onComplete: (result) => {
      void AsyncStorage.removeItem(ACTIVE_KEY);
      setLastOrder({ reference, amount: total, sessionId: result.sessionId, status: result.status });
      if (result.status === "success") {
        setBanner("Paid. Your server's webhook is the final word, but the sheet heard success.");
        setQty({});
      } else if (result.status === "cancelled") {
        setBanner("Payment cancelled. Your cart is untouched.");
      } else if (result.status === "expired") {
        setBanner("That payment session expired. Tap Pay to start a fresh one.");
      } else {
        setBanner("The payment did not go through. Try again or pick another method.");
      }
    },
    onCancel: () => {
      void AsyncStorage.removeItem(ACTIVE_KEY);
      setBanner("Sheet closed. Nothing was charged.");
    },
    onError: (error) => {
      setBanner(error.message);
    },
  });

  // Process-death recovery: if the app was killed mid-payment, offer to resume
  // the same session instead of minting another one.
  useEffect(() => {
    let alive = true;
    void AsyncStorage.getItem(ACTIVE_KEY).then((raw) => {
      if (!alive || !raw) return;
      try {
        const saved = JSON.parse(raw) as { session: MobilePaymentSession; publishableKey?: string; amount: number };
        if (new Date(saved.session.expires_at).getTime() < Date.now()) {
          void AsyncStorage.removeItem(ACTIVE_KEY);
          return;
        }
        Alert.alert(
          "Finish your payment?",
          `You have an unfinished payment of ${npr(saved.amount)}.`,
          [
            { text: "Discard", style: "destructive", onPress: () => void AsyncStorage.removeItem(ACTIVE_KEY) },
            {
              text: "Resume",
              onPress: () => {
                if (saved.publishableKey) setPublishableKey(saved.publishableKey);
                resume(saved.session);
              },
            },
          ],
        );
      } catch {
        void AsyncStorage.removeItem(ACTIVE_KEY);
      }
    });
    return () => {
      alive = false;
    };
  }, [resume]);

  const canPay = total >= 1_000 && !loading && name.trim().length > 1 && /^9[6-9]\d{8}$/.test(phone.trim()) && /\S+@\S+\.\S+/.test(email.trim());

  const pay = useCallback(() => {
    setBanner(null);
    void present();
  }, [present]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.bg }]} edges={["top", "left", "right"]}>
      <StatusBar style={dark ? "light" : "dark"} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View style={[styles.logo, { backgroundColor: c.primary }]}>
            <Text style={styles.logoText}>P</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: c.ink }]}>Demo Shop</Text>
            <Text style={[styles.sub, { color: c.muted }]}>Pays with the PayBridgeNP Payment Sheet · test mode</Text>
          </View>
        </View>

        {banner ? (
          <View style={[styles.banner, { backgroundColor: c.bannerBg, borderColor: c.bannerBorder }]}>
            <Text style={[styles.bannerText, { color: c.ink }]}>{banner}</Text>
          </View>
        ) : null}

        <Text style={[styles.h2, { color: c.muted }]}>Cart</Text>
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          {PRODUCTS.map((p, i) => {
            const q = qty[p.id] ?? 0;
            return (
              <View key={p.id} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border }]}>
                <Text style={styles.emoji}>{p.emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, { color: c.ink }]}>{p.name}</Text>
                  <Text style={[styles.blurb, { color: c.muted }]}>{p.blurb} · {npr(p.price)}</Text>
                </View>
                <Stepper value={q} onChange={(n) => setQty((s) => ({ ...s, [p.id]: n }))} c={c} />
              </View>
            );
          })}
          <View style={[styles.totalRow, { borderTopColor: c.border }]}>
            <Text style={[styles.totalLabel, { color: c.muted }]}>Total</Text>
            <Text style={[styles.total, { color: c.ink }]}>{npr(total)}</Text>
          </View>
        </View>

        <Text style={[styles.h2, { color: c.muted }]}>Buyer</Text>
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <Field label="Name" value={name} onChangeText={setName} c={c} autoCapitalize="words" />
          <Field label="Mobile" value={phone} onChangeText={setPhone} c={c} keyboardType="phone-pad" />
          <Field label="Email" value={email} onChangeText={setEmail} c={c} keyboardType="email-address" autoCapitalize="none" last />
        </View>

        <Pressable
          accessibilityRole="button"
          disabled={!canPay}
          onPress={pay}
          style={({ pressed }) => [
            styles.payBtn,
            { backgroundColor: c.primary, opacity: !canPay ? 0.45 : pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={styles.payText}>{loading ? "Starting payment…" : total >= 1_000 ? `Pay ${npr(total)}` : "Add something to the cart"}</Text>
        </Pressable>

        {lastOrder ? (
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border, marginTop: 16 }]}>
            <Text style={[styles.h3, { color: c.ink }]}>Last order</Text>
            <KV k="Status" v={lastOrder.status} c={c} />
            <KV k="Amount" v={npr(lastOrder.amount)} c={c} />
            <KV k="Session" v={lastOrder.sessionId} c={c} mono />
            <KV k="Reference" v={lastOrder.reference} c={c} mono />
          </View>
        ) : null}

        <Text style={[styles.foot, { color: c.muted }]}>
          Test mode: no real money moves. Khalti test wallet 9800000005 · MPIN 1111 · OTP 987654.
          {"\n"}Source: github.com/paybridgenp/mobile-sdk/tree/main/example
        </Text>
      </ScrollView>

      {/* The sheet lives once, at the root. present() opens it. */}
      <PaymentSheet {...paymentSheetProps} />
    </SafeAreaView>
  );
}

// ── Small pieces ─────────────────────────────────────────────────────────────

function Stepper({ value, onChange, c }: { value: number; onChange: (n: number) => void; c: Palette }) {
  return (
    <View style={[styles.stepper, { borderColor: c.border }]}>
      <Pressable accessibilityLabel="Remove one" onPress={() => onChange(Math.max(0, value - 1))} style={styles.stepBtn} hitSlop={8}>
        <Text style={[styles.stepText, { color: c.ink }]}>−</Text>
      </Pressable>
      <Text style={[styles.stepVal, { color: c.ink }]}>{value}</Text>
      <Pressable accessibilityLabel="Add one" onPress={() => onChange(Math.min(9, value + 1))} style={styles.stepBtn} hitSlop={8}>
        <Text style={[styles.stepText, { color: c.ink }]}>+</Text>
      </Pressable>
    </View>
  );
}

function Field(props: {
  label: string; value: string; onChangeText: (s: string) => void; c: Palette; last?: boolean;
  keyboardType?: "default" | "phone-pad" | "email-address"; autoCapitalize?: "none" | "words";
}) {
  const { label, value, onChangeText, c, last, keyboardType, autoCapitalize } = props;
  return (
    <View style={[styles.field, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border }]}>
      <Text style={[styles.fieldLabel, { color: c.muted }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize ?? "none"}
        autoCorrect={false}
        style={[styles.input, { color: c.ink }]}
        placeholderTextColor={c.muted}
      />
    </View>
  );
}

function KV({ k, v, c, mono }: { k: string; v: string; c: Palette; mono?: boolean }) {
  return (
    <View style={styles.kv}>
      <Text style={[styles.kvK, { color: c.muted }]}>{k}</Text>
      <Text style={[styles.kvV, { color: c.ink }, mono && styles.mono]} numberOfLines={1}>{v}</Text>
    </View>
  );
}

// ── Theme ────────────────────────────────────────────────────────────────────

type Palette = {
  bg: string; card: string; border: string; ink: string; muted: string; primary: string;
  bannerBg: string; bannerBorder: string;
};
const palette: { light: Palette; dark: Palette } = {
  light: { bg: "#F6F7F9", card: "#FFFFFF", border: "#E4E7EC", ink: "#0B1220", muted: "#667085", primary: "#155EEF", bannerBg: "#EEF4FF", bannerBorder: "#B2CCFF" },
  dark: { bg: "#0B0F17", card: "#131A26", border: "#243041", ink: "#F2F4F7", muted: "#98A2B3", primary: "#84ADFF", bannerBg: "#13203A", bannerBorder: "#2E4A86" },
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { padding: 18, paddingBottom: 40 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  logo: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  logoText: { color: "#fff", fontWeight: "800", fontSize: 20 },
  title: { fontSize: 22, fontWeight: "800", letterSpacing: -0.3 },
  sub: { fontSize: 12.5, marginTop: 2 },
  banner: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 14 },
  bannerText: { fontSize: 13.5, lineHeight: 19 },
  h2: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8, marginTop: 6 },
  h3: { fontSize: 15, fontWeight: "700", marginBottom: 8 },
  card: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, marginBottom: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  emoji: { fontSize: 26, width: 34, textAlign: "center" },
  name: { fontSize: 15, fontWeight: "600" },
  blurb: { fontSize: 12.5, marginTop: 2 },
  stepper: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 10, overflow: "hidden" },
  stepBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  stepText: { fontSize: 18, fontWeight: "600", lineHeight: 22 },
  stepVal: { minWidth: 22, textAlign: "center", fontSize: 15, fontWeight: "700" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", paddingVertical: 14, borderTopWidth: 1 },
  totalLabel: { fontSize: 13, fontWeight: "600" },
  total: { fontSize: 20, fontWeight: "800", fontVariant: ["tabular-nums"] },
  field: { paddingVertical: 10 },
  fieldLabel: { fontSize: 11.5, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  input: { fontSize: 16, paddingVertical: Platform.OS === "ios" ? 4 : 2 },
  payBtn: { borderRadius: 14, paddingVertical: 16, alignItems: "center" },
  payText: { color: "#fff", fontSize: 16.5, fontWeight: "700" },
  kv: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 6 },
  kvK: { fontSize: 13 },
  kvV: { fontSize: 13, fontWeight: "600", flexShrink: 1 },
  mono: { fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }), fontWeight: "500" },
  foot: { fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 18 },
});
