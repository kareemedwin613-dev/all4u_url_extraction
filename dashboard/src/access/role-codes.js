export const ROLE_CODES = Object.freeze({
  APPLIER: "APPLIER",
  APPLYING_MANAGER: "APPLYING_MANAGER",
  DEVELOPER: "DEVELOPER",
  DEVELOPMENT_MANAGER: "DEVELOPMENT_MANAGER",
  ADMIN: "ADMIN",
});

export const KNOWN_ROLE_CODES = Object.freeze(Object.values(ROLE_CODES));

export const ROLE_LABELS = Object.freeze({
  APPLIER: "Applier",
  APPLYING_MANAGER: "Applying Manager",
  DEVELOPER: "Developer",
  DEVELOPMENT_MANAGER: "Development Manager",
  ADMIN: "Admin",
});

export function roleLabel(code) {
  return ROLE_LABELS[String(code || "").toUpperCase()] || String(code || "Unknown role");
}
