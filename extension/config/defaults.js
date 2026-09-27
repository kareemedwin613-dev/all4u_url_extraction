// Connection settings built into the extension, so appliers have nothing to configure.
// These are public values: the same project URL and publishable key ship in the dashboard bundle.
// Never put a secret key here. A build can override them with EXTENSION_* environment variables
// (see scripts/build.mjs), and Settings can still override them locally for development.
const overrides = typeof __EXTENSION_CONFIG_OVERRIDES__ === "undefined" ? {} : __EXTENSION_CONFIG_OVERRIDES__;

export const BUILT_IN_CONFIG = Object.freeze({
  projectUrl: "https://wivndtpsksmggtalkwzg.supabase.co",
  publishableKey: "sb_publishable_X_FxL28LBl-3eB6Yp9mTIw_7YirGjPa",
  apiBaseUrl: "https://all4u-url-extraction.vercel.app",
  dashboardUrl: "https://all4u-url-extraction.vercel.app",
  ...overrides,
});
