import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";

type JsonRecord = Record<string, any>;

const text = (value: unknown): string => String(value ?? "").trim();
const values = (value: unknown): any[] => Array.isArray(value) ? value : [];
const datePart = (value: any): string => {
  if (!value || typeof value !== "object" || !value.year) return "";
  const month = Number(value.month);
  return month >= 1 && month <= 12 ? `${String(month).padStart(2, "0")}/${value.year}` : String(value.year);
};
const dateRange = (item: JsonRecord): string => {
  const start = datePart(item.start_date);
  const end = item.is_current ? "Present" : datePart(item.end_date);
  return [start, end].filter(Boolean).join(" – ");
};
const detailParagraphs = (value: unknown): Paragraph[] => text(value).split(/\r?\n/).map(line => line.replace(/^\s*[•*-]\s*/, "").trim()).filter(Boolean).map(line => new Paragraph({ text: line, bullet: { level: 0 }, spacing: { after: 60 } }));
const heading = (value: string): Paragraph => new Paragraph({ text: value, heading: HeadingLevel.HEADING_1, border: { bottom: { color: "2F75B5", style: BorderStyle.SINGLE, size: 6, space: 2 } }, spacing: { before: 220, after: 100 } });

export async function renderTailoredResumeDocx(input: JsonRecord): Promise<Buffer> {
  const candidate = input.candidate || {}, structured = input.sourceStructuredContent || {}, preview = input.approvedPreview || {};
  const previewById = new Map(values(preview.professionalExperience).map(item => [text(item.sourceExperienceId), text(item.tailoredDetails)]));
  const contact = [candidate.email, candidate.phone, [candidate.city, candidate.stateRegion, candidate.country].map(text).filter(Boolean).join(", ")].map(text).filter(Boolean).join("  |  ");
  const links = [candidate.linkedinUrl, candidate.githubUrl, candidate.portfolioUrl].map(text).filter(Boolean).join("  |  ");
  const children: Paragraph[] = [
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: text(candidate.name) || "Candidate", bold: true, size: 32 })], spacing: { after: 60 } }),
  ];
  if (contact) children.push(new Paragraph({ text: contact, alignment: AlignmentType.CENTER, spacing: { after: 40 } }));
  if (links) children.push(new Paragraph({ text: links, alignment: AlignmentType.CENTER, spacing: { after: 120 } }));
  children.push(heading("Summary"), new Paragraph({ text: text(preview.summary), spacing: { after: 120 } }), heading("Professional Experience"));
  for (const item of values(structured.professional_experience)) {
    const role = [text(item.job_title), text(item.company)].filter(Boolean).join(" — ");
    children.push(new Paragraph({ children: [new TextRun({ text: role, bold: true }), new TextRun({ text: dateRange(item) ? `    ${dateRange(item)}` : "", italics: true })], spacing: { before: 100, after: 30 } }));
    if (text(item.location)) children.push(new Paragraph({ children: [new TextRun({ text: text(item.location), italics: true })], spacing: { after: 40 } }));
    children.push(...detailParagraphs(previewById.get(text(item.id))));
  }
  const education = values(structured.education);
  if (education.length || text(structured.education_legacy_text)) {
    children.push(heading("Education"));
    for (const item of education) {
      children.push(new Paragraph({ children: [new TextRun({ text: text(item.institution), bold: true }), new TextRun({ text: dateRange(item) ? `    ${dateRange(item)}` : "", italics: true })], spacing: { after: 30 } }));
      const degree = [item.degree, item.field_of_study, item.gpa ? `GPA: ${item.gpa}` : ""].map(text).filter(Boolean).join(" — ");
      if (degree) children.push(new Paragraph({ text: degree }));
      if (text(item.details)) children.push(new Paragraph({ text: text(item.details), spacing: { after: 80 } }));
    }
    if (!education.length && text(structured.education_legacy_text)) children.push(new Paragraph({ text: text(structured.education_legacy_text) }));
  }
  const certifications = values(structured.certifications);
  if (certifications.length) {
    children.push(heading("Certifications"));
    for (const item of certifications) children.push(new Paragraph({ text: text(item.name ?? item), bullet: { level: 0 } }));
  }
  children.push(heading("Skills"), new Paragraph({ text: values(preview.skills).map(text).filter(Boolean).join(", ") }));
  const document = new Document({
    creator: "Resume JD Operations",
    title: `Tailored Resume for Application #${input.applicationNumber}`,
    description: "Human-approved Application-specific Resume",
    styles: { default: { document: { run: { font: "Arial", size: 20 }, paragraph: { spacing: { line: 276 } } } } },
    sections: [{ properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } }, children }],
  });
  return Packer.toBuffer(document);
}
