// ---------------------------------------------------------------------------
// eSewa payment bridge — WebView approach
// ---------------------------------------------------------------------------
// eSewa's official mobile SDK uses their old authentication flow which requires
// passing clientId + secretKey directly to the device (a security concern).
//
// Instead we use eSewa ePay v2 (same as our web flow):
//   1. Backend computes HMAC-signed form fields (native_params)
//   2. EsewaWebView auto-submits them to eSewa's ePay v2 endpoint in a WebView
//   3. eSewa redirects to success_url with ?data=<base64-encoded-json>
//   4. WebView intercepts the redirect, extracts the base64 data
//   5. SDK calls /v1/mobile/verify with the base64 data
//
// This keeps credentials server-side and reuses our existing verify infrastructure.
// ---------------------------------------------------------------------------

// eSewa uses EsewaWebView (React Native component) — no native module needed.
// This file is a re-export shim so ProviderSheet can import from providers/esewa
// without caring about the implementation detail.

export { EsewaWebView } from "../ui/EsewaWebView";
