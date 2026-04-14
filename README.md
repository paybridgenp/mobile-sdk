# @paybridge-np/mobile-sdk

Official React Native SDK for [PayBridge NP](https://paybridgenp.com) — accept eSewa and Khalti payments natively in your mobile app.

## Requirements

- React Native >= 0.73 (or Expo SDK >= 50)
- `react-native-webview` >= 13
- `react-native-safe-area-context` >= 4

## Installation

```bash
npm install @paybridge-np/mobile-sdk react-native-webview react-native-safe-area-context
```

```bash
# Expo
npx expo install @paybridge-np/mobile-sdk react-native-webview react-native-safe-area-context
```

> **Expo Go compatible** - no custom dev build or config plugin required.

---

## How it works

Your backend creates a checkout session using your secret API key. The session is passed to the mobile SDK - your API key never touches the device.

```
Your backend  →  POST /v1/mobile/session (API key)  →  { session_id, native_params, ... }
Mobile app    →  ProviderSheet / usePayBridge        →  onSuccess(result)
```

---

## Backend: create a session

Call `POST /v1/mobile/session` from your server with your PayBridge API key:

```bash
curl -X POST https://api.paybridgenp.com/v1/mobile/session \
  -H "Authorization: Bearer sk_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 5000,
    "provider": "khalti",
    "currency": "NPR",
    "customer": { "name": "Ram Bahadur", "phone": "98XXXXXXXX" }
  }'
```

Response:

```json
{
  "session_id": "cs_XXXX",
  "expires_at": "2026-04-14T12:00:00Z",
  "provider": "khalti",
  "amount": 5000,
  "native_params": { ... }
}
```

- `amount` is in **paisa** (1 NPR = 100 paisa)
- `provider` must be `"esewa"` or `"khalti"`
- Sessions expire in **15 minutes**
- Use `sk_test_...` keys for sandbox, `sk_live_...` for production

---

## Usage

### Option A - `usePayBridge` hook (recommended)

Lazy mode: show both providers, create the session only after the user picks one.

```tsx
import { usePayBridge, ProviderSheet } from "@paybridge-np/mobile-sdk";

export default function CheckoutScreen() {
  const { present, sheetProps } = usePayBridge({
    createSession: async (provider) => {
      const res = await fetch("https://your-backend.com/api/mobile-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, amount: 5000 }),
      });
      return res.json();
    },
    amount: 5000, // paisa - shown in the sheet before session is created
    onSuccess: (result) => console.log("paid", result.payment_id),
    onFailure: (result) => console.log("failed", result.error),
    onCancel: () => console.log("cancelled"),
  });

  return (
    <>
      <Button title="Pay NPR 50" onPress={present} />
      <ProviderSheet {...sheetProps} />
    </>
  );
}
```

### Option B - pre-built session

Use this when your backend picks the provider before showing the sheet.

```tsx
import { useState, useEffect } from "react";
import { usePayBridge, ProviderSheet } from "@paybridge-np/mobile-sdk";
import type { MobileSession } from "@paybridge-np/mobile-sdk";

export default function CheckoutScreen() {
  const [session, setSession] = useState<MobileSession | null>(null);

  useEffect(() => {
    fetch("https://your-backend.com/api/mobile-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "khalti", amount: 5000 }),
    })
      .then((r) => r.json())
      .then(setSession);
  }, []);

  const { present, sheetProps } = usePayBridge({
    session,
    onSuccess: (result) => console.log("paid", result.payment_id),
    onFailure: (result) => console.log("failed", result.error),
    onCancel: () => console.log("cancelled"),
  });

  return (
    <>
      <Button title="Pay" onPress={present} disabled={!session} />
      <ProviderSheet {...sheetProps} />
    </>
  );
}
```

### Option C - `ProviderSheet` directly

```tsx
import { ProviderSheet } from "@paybridge-np/mobile-sdk";

<ProviderSheet
  visible={sheetVisible}
  createSession={handleCreateSession}
  amount={5000}
  onSuccess={handleSuccess}
  onFailure={handleFailure}
  onCancel={handleCancel}
/>
```

---

## API reference

### `usePayBridge(options)`

| Option | Type | Description |
|---|---|---|
| `session` | `MobileSession \| null` | Pre-built session from your backend |
| `createSession` | `(provider) => Promise<MobileSession>` | Lazy factory - called when user picks a provider |
| `amount` | `number` | Amount in paisa - shown before session is created (lazy mode) |
| `config` | `PayBridgeMobileConfig` | Optional config (see below) |
| `onSuccess` | `(result: CheckoutResult) => void` | Called on successful payment |
| `onFailure` | `(result: CheckoutResult) => void` | Called on failed payment |
| `onCancel` | `() => void` | Called when user cancels |

Returns `{ present, dismiss, isVisible, sheetProps }`.

### `ProviderSheet` props

Same options as `usePayBridge`, plus `visible: boolean`.

### `PayBridgeMobileConfig`

| Field | Default | Description |
|---|---|---|
| `baseUrl` | `https://api.paybridgenp.com` | PayBridge API base URL |
| `timeout` | `30000` | Request timeout in ms |

### `CheckoutResult`

```ts
type CheckoutResult = {
  status: "success" | "failed" | "cancelled";
  payment_id?: string;
  amount?: number;        // paisa
  provider?: "esewa" | "khalti";
  provider_ref?: string;
  error?: string;
};
```

---

## Sandbox testing

Use `sk_test_...` keys on your backend.

**eSewa sandbox test credentials**
- eSewa ID: `9806800001` (or 02/03/04/05)
- Password: `Nepal@123`
- Token: `123456`

**Khalti sandbox** - handled automatically via your `sk_test_...` PayBridge key.

---

## License

MIT
