export interface TailoringApplication {
  id: string;
  applicationNumber: number;
}

export interface TailoringJobDescription {
  id: string;
  company: string;
  jobTitle: string;
  descriptionText: string;
  skills: string[];
}

export interface SourceExperience {
  id: string;
  company: string;
  title: string;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  details: string;
}

export interface TailoringSourceResume {
  id: string;
  resumeNumber: number;
  resumeType: "ORIGINAL";
  summary: string;
  skills: string[];
  professionalExperience: SourceExperience[];
  // Base cover letter text; present (possibly null) for input contract 1.4.
  coverLetter?: string | null;
}

export interface TailoringInput {
  contractVersion: "1.2" | "1.3" | "1.4";
  promptSnapshot?: TailoringPromptSnapshot;
  application: TailoringApplication;
  jobDescription: TailoringJobDescription;
  sourceResume: TailoringSourceResume;
}

export interface TailoringPromptSnapshot {
  promptId: string;
  name: string;
  version: number | null;
  instructions: string;
  contractVersion: "2" | "3" | "4";
  referenceDate: string;
  composedPrompt: string;
  isTest?: boolean;
  draftRevision?: number;
  [key: string]: unknown;
}

export interface TailoredExperience {
  sourceExperienceId: string;
  tailoredDetails: string;
}

export interface TailoredSkillGroup {
  name: string;
  skills: string[];
}

export interface TailoringOutput {
  summary: string;
  professionalExperience: TailoredExperience[];
  skills: string[];
  skillGroups: TailoredSkillGroup[];
  changeSummary: string[];
  unsupportedRequirements: string[];
  warnings: string[];
  // Body paragraphs only; present for input contract 1.4.
  coverLetter?: string;
}

export interface TailoringPreview {
  contractVersion: "1.2" | "1.3" | "1.4";
  promptProvenance?: Omit<TailoringPromptSnapshot, "instructions" | "composedPrompt">;
  applicationId: string;
  applicationNumber: number;
  sourceResumeId: string;
  sourceResumeNumber: number;
  generatedAt: string;
  generationAttempts?: number;
  result: TailoringOutput;
}

export interface FixtureFile {
  applications: TailoringInput[];
}
