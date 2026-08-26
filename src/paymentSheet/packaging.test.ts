// Every bare module the SDK imports must be declared in package.json, or a
// merchant who installs the published package gets "Unable to resolve module"
// the first time the sheet renders.
//
// This exists because a dependency once shipped imported-but-undeclared.
// Typecheck and unit tests both passed, because the module resolves fine in a
// development checkout. The failure only appears once the package is installed
// on its own.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const plugin = require("../../app.plugin.js").__test__ as {
  addAndroidQueries: (manifest: any) => any;
  addIosQueries: (plist: any) => any;
  ANDROID_PACKAGES: string[];
  ANDROID_SCHEMES: string[];
  IOS_SCHEMES: string[];
  PHOTO_LIBRARY_ADD_PERMISSION: string;
};

const SDK_ROOT = join(import.meta.dir, "..", "..");

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) acc.push(full);
  }
  return acc;
}

/** Bare specifiers only: not relative, not node:, not the bun test runner. */
function bareImports(code: string): string[] {
  const out = new Set<string>();
  for (const m of code.matchAll(/\bfrom\s+"([^"]+)"/g)) {
    const spec = m[1];
    if (spec.startsWith(".") || spec.startsWith("node:") || spec.startsWith("bun:")) continue;
    // Scoped packages keep two segments, others keep one.
    out.add(spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);
  }
  return [...out];
}

describe("published package resolves what it imports", () => {
  const pkg = JSON.parse(readFileSync(join(SDK_ROOT, "package.json"), "utf8"));
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ]);

  const imported = new Set<string>();
  for (const file of sourceFiles(join(SDK_ROOT, "src"))) {
    for (const spec of bareImports(readFileSync(file, "utf8"))) imported.add(spec);
  }

  test("finds imports at all (guards the walker itself)", () => {
    expect(imported.size).toBeGreaterThan(3);
    expect(imported.has("react-native")).toBe(true);
  });

  test.each([...imported].sort())("%s is declared in package.json", (spec) => {
    expect(declared.has(spec)).toBe(true);
  });
});

test("the published Expo plugin preserves existing queries and adds bank visibility", () => {
  const manifest = plugin.addAndroidQueries({ queries: [{ intent: [{ $: { existing: "true" } }] }] });
  expect(manifest.queries[0].intent[0]).toEqual({ $: { existing: "true" } });
  expect(manifest.queries[0].intent.slice(1).map((entry: any) => entry.data[0].$["android:scheme"])).toEqual(plugin.ANDROID_SCHEMES);
  expect(manifest.queries[0].package.map((entry: any) => entry.$["android:name"])).toEqual(plugin.ANDROID_PACKAGES);

  const plist = plugin.addIosQueries({ LSApplicationQueriesSchemes: ["merchantapp"] });
  expect(plist.LSApplicationQueriesSchemes).toEqual(["merchantapp", ...plugin.IOS_SCHEMES]);
  expect(plist.NSPhotoLibraryAddUsageDescription).toBe(plugin.PHOTO_LIBRARY_ADD_PERMISSION);
});

test("eSewa Intent waits for app detection and never exposes its separate ePay fallback", () => {
  const sheet = readFileSync(join(SDK_ROOT, "src/paymentSheet/PaymentSheet.tsx"), "utf8");
  expect(sheet).toContain('esewaInstalled === null ? await isEsewaInstalled()');
  expect(sheet).not.toContain("openEsewaIntent(intentUrl, Boolean(next.native_params.form_url))");
  expect(sheet).not.toContain("fallbackAvailable");
  expect(sheet).toContain('intentPhase === "returned" || intentPhase === "unavailable" ? <TouchableOpacity');
  expect(sheet).toContain('<Text accessibilityRole="alert" style={[styles.error');
  expect(sheet).toContain('if (status === "failed" || status === "cancelled") await chooseAnotherMethod()');
  expect(sheet).not.toContain('bankPicker ? () => void chooseAnotherMethod()');
});

test("an expired Fonepay QR rotates even after it was scanned", () => {
  const sheet = readFileSync(join(SDK_ROOT, "src/paymentSheet/PaymentSheet.tsx"), "utf8");
  const start = sheet.indexOf("secondsUntil(action.expires_at) === 0");
  const autoRefresh = sheet.slice(start, sheet.indexOf("useEffect(() => {", start));
  expect(autoRefresh).toContain("void refreshFonepayQr(action)");
  expect(autoRefresh).not.toContain("scannedQr.current");
});

test("large text can wrap provider copy without clipping the bank-picker action", () => {
  const sheet = readFileSync(join(SDK_ROOT, "src/paymentSheet/PaymentSheet.tsx"), "utf8");
  expect(sheet).not.toContain("<Text numberOfLines={1} style={[styles.rowSub");
  expect(sheet).toContain('accessibilityLabel="Other payment methods"');
  expect(sheet).toContain('busy === "change-method" ? "Returning…" : "Methods"');
});
