export function referenceResumeFixture(long?: boolean): {
  applicationNumber: number;
  candidate: Record<string, string>;
  targetJob: { title: string; company: string };
  resumeSeniority: string;
  sourceStructuredContent: {
    professional_experience: Array<{
      id: string; job_title: string; company: string;
      start_date: { year: number; month: number };
      end_date: { year: number; month: number } | null;
      is_current: boolean; experience_details: string;
    }>;
    education: Array<{
      institution: string; degree: string; field_of_study: string;
      start_date: { year: number }; end_date: { year: number };
    }>;
    certifications: unknown[];
  };
  approvedPreview: {
    summary: string;
    professionalExperience: Array<{ sourceExperienceId: string; tailoredDetails: string }>;
    skills: string[];
    skillGroups: Array<{ name: string; skills: string[] }>;
  };
};
