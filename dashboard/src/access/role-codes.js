export const ROLE_CODES = Object.freeze({
  APPLIER: "APPLIER",
  APPLYING_MANAGER: "APPLYING_MANAGER",
  DEVELOPER: "DEVELOPER",
  DEVELOPMENT_MANAGER: "DEVELOPMENT_MANAGER",
  JD_FINDER: "JD_FINDER",
  ADMIN: "ADMIN",
});

export const KNOWN_ROLE_CODES = Object.freeze(Object.values(ROLE_CODES));

export const ROLE_LABELS = Object.freeze({
  APPLIER: "Applier",
  APPLYING_MANAGER: "Applying Manager",
  DEVELOPER: "Developer",
  DEVELOPMENT_MANAGER: "Development Manager",
  JD_FINDER: "JD Finder",
  ADMIN: "Admin",
});

export const ROLE_COLORS = Object.freeze({
  APPLIER: "cyan",
  APPLYING_MANAGER: "blue",
  DEVELOPER: "geekblue",
  DEVELOPMENT_MANAGER: "purple",
  JD_FINDER: "orange",
  ADMIN: "magenta",
});

export function roleLabel(code) {
  return ROLE_LABELS[String(code || "").toUpperCase()] || String(code || "Unknown role");
}

export function roleColor(code) {
  return ROLE_COLORS[String(code || "").toUpperCase()] || "default";
}
