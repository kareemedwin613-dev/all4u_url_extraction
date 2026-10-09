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
  // Admin key used only by the extension-pairing module to create extension sessions, and by the autofill-ai
  // module to save learned question wordings. Optional: without it the API runs normally, "Connect with
  // dashboard" reports it is not configured, and AI-recognized wordings are used but not remembered.
  SUPABASE_SECRET_KEY?: string;
  // Autofill AI (apps/api/src/autofill-ai). Keys live only here. Admins choose on/off, provider, models and cap on
  // the dashboard; the AUTOFILL_AI_* values below are the defaults until an Admin first saves those settings.
  OPENAI_API_KEY?: string;
  XAI_API_KEY?: string;
  AUTOFILL_AI_ENABLED: boolean;
  AUTOFILL_AI_PROVIDER: "openai" | "xai";
  AUTOFILL_AI_MODEL?: string;
  AUTOFILL_AI_MONTHLY_CAP_USD: number;
  RATE_LIMIT_TTL_MS: number;
  RATE_LIMIT_MAX: number;
  INGESTION_RATE_LIMIT_MAX: number;
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
  SUPABASE_SECRET_KEY: Joi.string().min(20).allow("").optional(),
  OPENAI_API_KEY: Joi.string().min(20).allow("").optional(),
  XAI_API_KEY: Joi.string().min(20).allow("").optional(),
  AUTOFILL_AI_ENABLED: Joi.boolean().default(false),
  AUTOFILL_AI_PROVIDER: Joi.string().valid("openai", "xai").default("xai"),
  AUTOFILL_AI_MODEL: Joi.string().pattern(/^[a-z0-9][a-z0-9.-]{1,60}$/).allow("").optional(),
  AUTOFILL_AI_MONTHLY_CAP_USD: Joi.number().min(0).max(10000).default(50),
  RATE_LIMIT_TTL_MS: Joi.number().integer().min(1000).default(60000),
  RATE_LIMIT_MAX: Joi.number().integer().min(1).default(60),
  INGESTION_RATE_LIMIT_MAX: Joi.number().integer().min(1).default(20),
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
  return value;
}

let cached: Environment | undefined;
export const environment = () => (cached ??= validateEnvironment());
export const resetEnvironmentForTests = () => { cached = undefined; };
