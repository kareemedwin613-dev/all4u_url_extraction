const date = (value) => (value ? String(value).slice(0, 10) : "");
const isoDate = (value) => {
  const text = date(value);
  return text || null;
};

export function buildStructuredResumeSaveBody(draft) {
  return {
    summary: draft.summary || "",
    skills: draft.skills || "",
    employment: (draft.employment || []).map((item, index) => ({
      id: item.id || undefined,
      company: String(item.company || "").trim(),
      jobTitle: String(item.jobTitle || "").trim(),
      location: String(item.location || "").trim() || undefined,
      startDate: isoDate(item.startDate),
      endDate: item.isCurrent ? null : isoDate(item.endDate),
      isCurrent: Boolean(item.isCurrent),
      experienceDetails: String(item.experienceDetails || "").trim() || undefined,
      displayOrder: index,
    })),
    education: (draft.education || []).map((item, index) => ({
      id: item.id || undefined,
      institution: String(item.institution || "").trim(),
      degree: String(item.degree || "").trim() || undefined,
      fieldOfStudy: String(item.fieldOfStudy || "").trim() || undefined,
      location: String(item.location || "").trim() || undefined,
      startDate: isoDate(item.startDate),
      endDate: isoDate(item.endDate),
      gpa: String(item.gpa || "").trim() || undefined,
      details: String(item.details || "").trim() || undefined,
      displayOrder: index,
    })),
    certifications: (draft.certifications || []).map((item) => ({
      id: item.id || undefined,
      name: String(item.name || "").trim(),
      issuer: String(item.issuer || "").trim() || undefined,
      issuedDate: isoDate(item.issuedDate),
      expirationDate: isoDate(item.expirationDate),
      credentialId: String(item.credentialId || "").trim() || undefined,
      credentialUrl: String(item.credentialUrl || "").trim() || undefined,
    })),
  };
}
