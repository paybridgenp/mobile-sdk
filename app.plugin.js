const { withAndroidManifest, withInfoPlist } = require("expo/config-plugins");

const IOS_SCHEMES = [
  "esewa",
  "nabilfonepay", "kumarifonepay", "laxmisunrisefonepay", "prabhufonepay",
  "rbbfonepay", "sanimafonepay", "adblfonepay", "citizensfonepay",
  "garimafonepay", "manjushreefonepay", "muktinathfonepay",
  "siddharthafonepay", "nimbfonepay", "everestfonepay",
  "kamanasewafonepay", "mahalaxmifonepay", "shineresungafonepay",
  "jyotifonepay", "machhapuchchhrefonepay",
];

const ANDROID_SCHEMES = ["esewa"];

const ANDROID_PACKAGES = [
  "com.f1soft.esewa", "com.f1soft.esewa.debug",
  "com.f1soft.nabilmbank", "com.f1soft.kumarimobilebanking",
  "com.laxmibank.mobilemoney", "com.f1soft.kistmobilebanking.activities.main",
  "com.f1soft.rastriyabanijyamobilebanking", "com.f1soft.sanimamobilebanking",
  "com.f1soft.banksmart.adbl", "com.f1soft.citizensmobilebanking",
  "com.f1soft.garimamobilebanking", "com.f1soft.manjushreefinance",
  "com.f1soft.muktinathmobilebanking", "com.f1soft.banksmart.siddhartha",
  "com.f1soft.megafonebank.activities.starter", "com.everestbankltd.mbanking",
  "com.f1soft.shineresungamobilebanking", "com.f1soft.jyotimobilebanking",
];

const PHOTO_LIBRARY_ADD_PERMISSION = "Allow this app to save payment QR codes to your photo library.";

function addAndroidQueries(manifest) {
  const queries = manifest.queries ?? [];
  const query = queries[0] ?? {};
  const packages = query.package ?? [];
  const existing = new Set(packages.map((entry) => entry.$?.["android:name"]));
  query.package = [
    ...packages,
    ...ANDROID_PACKAGES.filter((name) => !existing.has(name)).map((name) => ({ $: { "android:name": name } })),
  ];
  const intents = query.intent ?? [];
  const existingSchemes = new Set(intents.flatMap((entry) => entry.data ?? []).map((entry) => entry.$?.["android:scheme"]));
  query.intent = [
    ...intents,
    ...ANDROID_SCHEMES.filter((scheme) => !existingSchemes.has(scheme)).map((scheme) => ({
      action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
      category: [{ $: { "android:name": "android.intent.category.BROWSABLE" } }],
      data: [{ $: { "android:scheme": scheme } }],
    })),
  ];
  manifest.queries = queries.length > 0 ? [query, ...queries.slice(1)] : [query];
  return manifest;
}

function addIosQueries(plist) {
  const existing = Array.isArray(plist.LSApplicationQueriesSchemes)
    ? plist.LSApplicationQueriesSchemes
    : [];
  plist.LSApplicationQueriesSchemes = [...new Set([...existing, ...IOS_SCHEMES])];
  plist.NSPhotoLibraryAddUsageDescription ??= PHOTO_LIBRARY_ADD_PERMISSION;
  return plist;
}

function withPayBridgeMobileSdk(config) {
  config = withAndroidManifest(config, (mod) => {
    mod.modResults.manifest = addAndroidQueries(mod.modResults.manifest);
    return mod;
  });
  return withInfoPlist(config, (mod) => {
    mod.modResults = addIosQueries(mod.modResults);
    return mod;
  });
}

module.exports = withPayBridgeMobileSdk;
module.exports.__test__ = {
  addAndroidQueries,
  addIosQueries,
  ANDROID_PACKAGES,
  ANDROID_SCHEMES,
  IOS_SCHEMES,
  PHOTO_LIBRARY_ADD_PERMISSION,
};
