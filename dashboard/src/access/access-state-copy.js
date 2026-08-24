export const ACCESS_STATE_COPY = Object.freeze({
  PENDING_ACCESS: {
    title: "Pending Access",
    message:
      "Your registration was received. An administrator must approve your account and assign a role (for example Applier) before you can use the workspace.",
  },
  ACCOUNT_INACTIVE: {
    title: "Account Inactive",
    message:
      "Your platform account is inactive. Contact an administrator if you believe this is a mistake.",
  },
  ACCESS_DENIED: {
    title: "Access Denied",
    message: "Your assigned roles do not allow access to this page.",
  },
  ACCESS_ERROR: {
    title: "Access could not be loaded",
    message: "Your access context could not be loaded.",
  },
});
