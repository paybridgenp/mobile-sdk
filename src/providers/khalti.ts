// ---------------------------------------------------------------------------
// Khalti payment bridge — WebView approach
// ---------------------------------------------------------------------------
// Khalti v2 ePay flow:
//   1. Backend creates session → returns payment_url + pidx in native_params
//   2. KhaltiWebView opens payment_url in a full-screen WebView
//   3. Khalti redirects to return_url with ?pidx=xxx&status=Completed
//   4. WebView intercepts the redirect, extracts pidx
//   5. SDK calls /v1/mobile/verify with pidx
//
// This keeps credentials server-side and avoids any native SDK dependency.
// ---------------------------------------------------------------------------

// Khalti uses KhaltiWebView (React Native component) — no native module needed.
// This file is a re-export shim so ProviderSheet can import from providers/khalti
// without caring about the implementation detail.

export { KhaltiWebView } from "../ui/KhaltiWebView";
