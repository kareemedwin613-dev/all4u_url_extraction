const emailLocalPart = (email) => {
  const value = String(email || "").trim();
  if (!value.includes("@")) return value;
  return value.slice(0, value.indexOf("@")) || value;
};

export const isEmailLike = (value, email) => {
  const text = String(value || "")
    .trim()
    .toLowerCase();
  const mail = String(email || "")
    .trim()
    .toLowerCase();
  return Boolean(text) && (text === mail || text.includes("@"));
};

/** Prefer a real person name; avoid showing a raw email as the primary label. */
export function personDisplayName({
  fullName,
  displayName,
  email,
  userId,
  fallback = "Unknown user",
} = {}) {
  const mail = String(email || "").trim();
  for (const candidate of [fullName, displayName]) {
    const name = String(candidate || "").trim();
    if (name && !isEmailLike(name, mail)) return name;
  }
  if (mail) return emailLocalPart(mail);
  return userId || fallback;
}
