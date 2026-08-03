import Joi from "joi";

export interface Environment {
  NODE_ENV: "development" | "test" | "production";
  PORT: number;
  API_BASE_PATH: string;
  CORS_ORIGINS: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_OR_PUBLISHABLE_KEY: string;
  SUPABASE_JWT_ISSUER: string;
  SUPABASE_JWKS_URL: string;
  SUPABASE_JWT_AUDIENCE?: string;
  RATE_LIMIT_TTL_MS: number;
  RATE_LIMIT_MAX: number;
  INGESTION_RATE_LIMIT_MAX: number;
  GOOGLE_WORKSPACE_JD_SYNC_ENABLED: boolean;
  GOOGLE_WORKSPACE_JD_SYNC_URL: string;
  GOOGLE_WORKSPACE_JD_SYNC_SECRET: string;
  GOOGLE_WORKSPACE_JD_SYNC_TIMEOUT_MS: number;
  LOG_LEVEL: "debug" | "info" | "warn" | "error";
  SWAGGER_ENABLED: boolean;
}

const schema = Joi.object<Environment>({
  NODE_ENV: Joi.string().valid("development", "test", "production").default("development"),
  PORT: Joi.number().port().default(3000),
  API_BASE_PATH: Joi.string().pattern(/^[a-z0-9/-]+$/i).default("api/v1"),
  CORS_ORIGINS: Joi.string().min(1).required(),
  SUPABASE_URL: Joi.string().uri({ scheme: ["https"] }).required(),
  SUPABASE_ANON_OR_PUBLISHABLE_KEY: Joi.string().min(20).required(),
  SUPABASE_JWT_ISSUER: Joi.string().uri({ scheme: ["https"] }).required(),
  SUPABASE_JWKS_URL: Joi.string().uri({ scheme: ["https"] }).required(),
  SUPABASE_JWT_AUDIENCE: Joi.string().allow("").optional(),
  RATE_LIMIT_TTL_MS: Joi.number().integer().min(1000).default(60000),
  RATE_LIMIT_MAX: Joi.number().integer().min(1).default(60),
  INGESTION_RATE_LIMIT_MAX: Joi.number().integer().min(1).default(20),
  GOOGLE_WORKSPACE_JD_SYNC_ENABLED: Joi.boolean().default(false),
  GOOGLE_WORKSPACE_JD_SYNC_URL: Joi.string().allow("").default(""),
  GOOGLE_WORKSPACE_JD_SYNC_SECRET: Joi.string().allow("").default(""),
  GOOGLE_WORKSPACE_JD_SYNC_TIMEOUT_MS: Joi.number().integer().min(1000).max(10000).default(5000),
  LOG_LEVEL: Joi.string().valid("debug", "info", "warn", "error").default("info"),
  SWAGGER_ENABLED: Joi.boolean().default(true),
}).unknown(true);

export function validateEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  const { value, error } = schema.validate(source, { abortEarly: false, convert: true });
  if (error) throw new Error(`Invalid API environment: ${error.details.map((item) => item.message).join("; ")}`);
  const key = String(value.SUPABASE_ANON_OR_PUBLISHABLE_KEY).toLowerCase();
  if (key.includes(["service", "role"].join("_"))) throw new Error("Invalid API environment: a privileged Supabase key is not allowed.");
  const supabase = new URL(value.SUPABASE_URL), issuer = new URL(value.SUPABASE_JWT_ISSUER), jwks = new URL(value.SUPABASE_JWKS_URL);
  if (!supabase.hostname.endsWith(".supabase.co") || (supabase.pathname !== "/" && supabase.pathname !== "")) throw new Error("Invalid API environment: SUPABASE_URL must be a standard https://<project-ref>.supabase.co URL.");
  if (issuer.hostname !== supabase.hostname || jwks.hostname !== supabase.hostname) throw new Error("Invalid API environment: JWT issuer and JWKS must use the same Supabase project hostname.");
  if (value.GOOGLE_WORKSPACE_JD_SYNC_ENABLED) {
    let workspaceUrl: URL;
    try { workspaceUrl = new URL(value.GOOGLE_WORKSPACE_JD_SYNC_URL); } catch { throw new Error("Invalid API environment: GOOGLE_WORKSPACE_JD_SYNC_URL must be an HTTPS Apps Script deployment URL."); }
    if (workspaceUrl.protocol !== "https:" || !["script.google.com","script.googleusercontent.com"].includes(workspaceUrl.hostname)) throw new Error("Invalid API environment: GOOGLE_WORKSPACE_JD_SYNC_URL must use an official Google Apps Script HTTPS host.");
    if (value.GOOGLE_WORKSPACE_JD_SYNC_SECRET.length < 32) throw new Error("Invalid API environment: GOOGLE_WORKSPACE_JD_SYNC_SECRET must contain at least 32 characters when mirroring is enabled.");
  }
  return value;
}

let cached: Environment | undefined;
export const environment = () => (cached ??= validateEnvironment());
export const resetEnvironmentForTests = () => { cached = undefined; };
