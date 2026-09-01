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
}

export interface TailoringInput {
  contractVersion: "1.2";
  application: TailoringApplication;
  jobDescription: TailoringJobDescription;
  sourceResume: TailoringSourceResume;
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
}

export interface TailoringPreview {
  contractVersion: "1.2";
  applicationId: string;
  applicationNumber: number;
  sourceResumeId: string;
  sourceResumeNumber: number;
  generatedAt: string;
  result: TailoringOutput;
}

export interface FixtureFile {
  applications: TailoringInput[];
}
