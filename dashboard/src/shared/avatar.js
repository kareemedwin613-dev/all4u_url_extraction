export function personInitials(name = "") {
  const parts = String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

export function avatarColor(value = "") {
  const palette = [
    "#1768b5",
    "#389e0d",
    "#d46b08",
    "#722ed1",
    "#08979c",
    "#c41d7f",
  ];
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = value.charCodeAt(index) + ((hash << 5) - hash);
  }
  return palette[Math.abs(hash) % palette.length];
}
