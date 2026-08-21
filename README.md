# @paybridge-np/mobile-sdk

<p align="center">
  <img src="https://raw.githubusercontent.com/paybridgenp/mobile-sdk/main/assets/payment-sheet.webp" width="280" alt="The PayBridgeNP payment sheet on iOS showing Bank App, Fonepay QR, eSewa and Khalti" />
</p>

Official PayBridgeNP React Native payment sheet for Fonepay, eSewa, and Khalti inside iOS and Android apps. Your backend creates one mobile session; the SDK presents only the payment methods frozen in that server response. The app never sends an amount, constructs a bank-payment URL, or treats a client callback as payment proof.

## Install

```bash
npm install @paybridge-np/mobile-sdk react-native-webview react-native-safe-area-context
```

The SDK's QR renderer and Fonepay event stream are JavaScript-only dependencies, so they need no native linking. `react-native-webview` and `react-native-safe-area-context` remain peer dependencies.

Expo Go is enough to preview the sheet and hosted eSewa/Khalti screens. Native QR sharing and reliable installed-app detection require the config plugin and a development build:

```json
{
  "expo": {
    "scheme": "myapp",
    "plugins": ["@paybridge-np/mobile-sdk"]
  }
}
```

`expo` is an optional peer dependency: bare React Native apps install nothing extra, and the plugin is only read by Expo projects that list it. After adding the plugin, rebuild the native app (`npx expo prebuild` and your normal development-build command). Expo Go cannot apply native app-query configuration. eSewa's sandbox Intent app is currently Android-only.

## Use the payment sheet

Create the session on your backend with your `sk_` key, omitting `provider`:

```ts
// server only
const session = await paybridge.mobile.createSession({
  amount: 5000, // paisa
  customer: { name: "Ram Bahadur", email: "ram@example.com", phone: "9800000000" },
});
```

Pass that response through your own authenticated backend endpoint, then use the hook. The application builds no provider picker.

Your backend should send one stable `Idempotency-Key` per merchant order when it calls `POST /v1/mobile/session`. Retrying then returns the original session instead of creating a second payable session.

```tsx
import { Button } from "react-native";
import { PaymentSheet, usePaymentSheet } from "@paybridge-np/mobile-sdk";

export function Checkout() {
  const { present, loading, paymentSheetProps } = usePaymentSheet({
    fetchSession: async () => {
      const response = await fetch("https://merchant.example/mobile-payment-session");
      if (!response.ok) throw new Error("Could not start payment");
      return response.json();
    },
    publishableKey: "pk_live_…",
    // Required for eSewa Intent. Configure the same scheme in your app.
    returnUrl: "myapp://paybridge/return",
    // Use config: { baseUrl: "https://staging-api.example.com" } outside production.
    appearance: {
      colors: { light: { primary: "#155EEF" }, dark: { primary: "#84ADFF" } },
      radius: 16,
      fonts: { family: "System", headingFamily: "System" },
      primaryButton: { backgroundColor: "#155EEF", textColor: "#fff" },
    },
    onComplete: ({ status, sessionId }) => {
      if (status === "success") console.log("Server reports paid", sessionId);
    },
    onCancel: () => console.log("Customer closed the sheet"),
    onError: (error) => console.warn(error.message),
  });

  return <>
    <Button title="Pay" disabled={loading} onPress={() => void present()} />
    <PaymentSheet {...paymentSheetProps} />
  </>;
}
```

`fetchSession` must return the provider-omitted response from `POST /v1/mobile/session`:

```ts
type MobilePaymentSession = {
  session_id: string;
  client_secret: string;
  amount: number; // paisa
  mode: "sandbox" | "live";
  expires_at: string;
  methods: MobileMethod[];
};
```

The sheet renders only server-supplied methods. When a supported bank app is installed, Bank App is placed before Fonepay QR and a single installed bank opens directly; multiple installed banks use a compact in-sheet picker. eSewa Intent is used only when the feature is eligible and the eSewa app is detected; otherwise the sheet uses eSewa's hosted checkout.

Payment completion is reported only after `GET /v1/mobile/session/:id/status` says `success`. Fonepay listens to its authenticated SSE endpoint, shows waiting/scanned states, and safely refreshes an expired display QR while its late-payment listener remains active. Eligible eSewa sessions open Intent when `returnUrl` is configured; if Intent cannot open, the buyer can retry it or wait for its provider-side cancellation before choosing another method. Other eSewa sessions use ePay v2 directly. Cancelling an individual provider returns to the method picker only after reconciliation and, for eSewa Intent, provider-side cancellation. Closing the whole sheet calls `onCancel`; it dismisses the UI and does not mark the server session cancelled. Provider WebViews have a navigation allowlist, cancel, timeout/retry, and offline recovery.

For process-death recovery, keep the active session in platform-secure storage and call the hook's `resume(session)` after restoring your checkout screen. The SDK deliberately does not own merchant navigation or silently persist the client secret. Clear the stored session after `onComplete` or an explicit sheet close.

## Appearance

Appearance accepts color tokens for `light` and `dark`, a radius, font families, and the primary-button colors. It deliberately does not accept layout overrides, so payment controls retain a predictable, reviewable structure.

## Legacy API

`usePayBridgeNP` and `ProviderSheet` remain exported for existing installs but are deprecated. New integrations should use `usePaymentSheet` and `PaymentSheet`.
