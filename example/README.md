# PayBridgeNP Demo Shop

A tiny React Native store that takes a payment with the PayBridgeNP **Payment Sheet**: Fonepay (QR and bank apps), eSewa, and Khalti, in one sheet, from one server-created session.

It runs in **Expo Go** (test mode, no real money) and is the source for the screenshots and videos in the [mobile SDK docs](https://docs.paybridgenp.com/sdk/mobile).

## Run it

```bash
cd example
bun install        # or npm install
bunx expo start    # scan the QR with Expo Go
```

No configuration needed. The app asks PayBridgeNP's public demo endpoint for a **sandbox** session on the PayBridgeNP demo merchant. Test with Khalti wallet `9800000005`, MPIN `1111`, OTP `987654`.

## Use your own merchant

1. On **your server**, create the session with your `sk_` key: `POST /v1/mobile/session` with `amount` (paisa) and `customer`, omitting `provider`. Send one stable `Idempotency-Key` per order. The [route this demo uses](https://github.com/paybridgenp/paybridge-np-web/blob/main/src/app/api/demo/mobile-session/route.ts) is a complete example.
2. Copy `.env.example` to `.env`, set `EXPO_PUBLIC_PAYBRIDGE_DEMO_API` to your endpoint and `EXPO_PUBLIC_PAYBRIDGE_PUBLISHABLE_KEY` to your `pk_` key.
3. `bunx expo start`.

## What to look at

Everything lives in [`App.tsx`](./App.tsx):

- `createSessionOnServer()`: the one call to your backend.
- `usePaymentSheet({ fetchSession, publishableKey, returnUrl, appearance, onComplete, onCancel, onError })`: the hook.
- `<PaymentSheet {...paymentSheetProps} />`: rendered once at the root; `present()` opens it.
- `AsyncStorage` + `resume(session)`: process-death recovery, so a killed app offers to finish the same payment instead of minting a second one.

Fonepay QR sharing needs a development build (Expo Go has no native share module); the sheet says so when tapped. Everything else works in Expo Go.
