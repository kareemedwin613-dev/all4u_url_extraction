export function normalizeCompanyName(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function findGlobalBannedCompany(company, entries = []) {
  const normalized = normalizeCompanyName(company);
  if (!normalized) return null;
  return (entries || []).find((entry) => normalizeCompanyName(entry?.companyName || entry?.company_name || entry?.normalizedCompany) === normalized) || null;
}
