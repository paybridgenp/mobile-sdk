// The demo depends on the SDK one directory up (`"@paybridge-np/mobile-sdk": "file:.."`),
// so Metro has to watch that folder and must resolve React / React Native from
// THIS app only. Resolving them from the SDK's own node_modules (or any parent
// workspace root) would load two copies of React and break hooks.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const sdkRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [sdkRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];
config.resolver.disableHierarchicalLookup = true;
config.resolver.unstable_enableSymlinks = true;
config.resolver.extraNodeModules = {
  "@paybridge-np/mobile-sdk": sdkRoot,
};
// The SDK's own tests and node_modules are never part of the app bundle.
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
config.resolver.blockList = [
  // The SDK's own node_modules are never part of the app bundle.
  new RegExp(`${esc(sdkRoot)}/node_modules/.*`),
  // bun copies a `file:..` dependency into node_modules; block that snapshot so
  // extraNodeModules above resolves the LIVE source one directory up.
  new RegExp(`${esc(path.resolve(projectRoot, "node_modules/@paybridge-np/mobile-sdk"))}/.*`),
  /.*\.test\.(ts|tsx)$/,
];

module.exports = config;
