import { Transform, Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsIn, IsISO8601, IsOptional, IsString, IsUUID, Length, MaxLength, ValidateNested } from "class-validator";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);
const emptyToUndefined = ({ value }: { value: unknown }) => {
  if (typeof value !== "string") return value;
  const text = value.trim();
  return text ? text : undefined;
};

const STAGES = ["RECRUITER", "HIRING_MANAGER", "TECH", "FINAL"] as const;
const STATUSES = ["UPCOMING", "COMPLETED", "REJECTED", "NOT_JOINED", "RESCHEDULED", "NEEDS_FOLLOW_UP"] as const;
const TYPES = ["TEAMS", "GOOGLE_MEET", "ZOOM", "VIDEO", "PHONE", "AI_INTERVIEW"] as const;
const JOB_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACT"] as const;
const LOCATIONS = ["REMOTE", "ONSITE", "HYBRID"] as const;
const ROUND_STATUSES = ["", "PASSED", "UPCOMING", "FAILED"] as const;

export class InterviewRoundDto {
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  roundName!: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsISO8601({ strict: true })
  startsAt?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsISO8601({ strict: true })
  endsAt?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  interviewer?: string;

  @Transform(({ value }) => (typeof value === "string" ? value.trim().toUpperCase() : value ?? ""))
  @IsIn(ROUND_STATUSES)
  status: string = "";

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class InterviewDto {
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsUUID("4")
  applicationId?: string;

  @IsISO8601({ strict: true })
  startsAt!: string;

  @IsISO8601({ strict: true })
  endsAt!: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsUUID("4")
  intervieweeUserId?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  intervieweeName?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  profileName?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(320)
  profileEmail?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(60)
  profilePhone?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  professionalStack?: string;

  @Transform(trim)
  @IsString()
  @Length(1, 200)
  companyName!: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  companyWebsite?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  jobLink?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  roleTitle?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsIn(JOB_TYPES)
  jobType?: (typeof JOB_TYPES)[number];

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsIn(LOCATIONS)
  location?: (typeof LOCATIONS)[number];

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  salaryRange?: string;

  @IsIn(STAGES)
  stage!: (typeof STAGES)[number];

  @IsIn(STATUSES)
  status!: (typeof STATUSES)[number];

  @IsIn(TYPES)
  interviewType!: (typeof TYPES)[number];

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  meetingUrl?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  meetingId?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  passcode?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  recruiterName?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(320)
  recruiterEmail?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(60)
  recruiterPhone?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  interviewers?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  interviewerPosition?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  interviewerLocation?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  detailedInformation?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  linkedinUrl?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  resumeLink?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  place?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(10)
  appliedDate?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  notes?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => InterviewRoundDto)
  rounds?: InterviewRoundDto[];
}
