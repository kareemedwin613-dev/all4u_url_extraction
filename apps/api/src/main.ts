import "reflect-metadata";
import { HttpStatus, type INestApplication, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module.js";
import { environment } from "./config/environment.js";
import { JsonLogger } from "./common/logging/json-logger.service.js";
import { ApiException } from "./common/errors/api.exception.js";
import { ApiExceptionFilter } from "./common/errors/api-exception.filter.js";
import { pathToFileURL } from "node:url";

// Bulk create allows up to 2,000 JD×Resume pairs (~200KB+ JSON). Default Express limit is 100kb.
const JSON_BODY_LIMIT = "2mb";

export async function createApiApplication(options: { serverless?: boolean } = {}): Promise<INestApplication> {
  const env = environment();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, bodyParser: false });
  const logger = app.get(JsonLogger);
  app.useLogger(logger);
  app.useBodyParser("json", { limit: JSON_BODY_LIMIT });
  app.useBodyParser("urlencoded", { limit: JSON_BODY_LIMIT, extended: true });
  if (!options.serverless) app.enableShutdownHooks();
  app.setGlobalPrefix(env.API_BASE_PATH, { exclude: ["health", "ready", "api/docs"] });
  const origins = env.CORS_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean);
  if (origins.includes("*")) throw new Error("CORS_ORIGINS cannot contain an unrestricted wildcard.");
  app.enableCors({ origin: origins, credentials: false, methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key", "X-Request-ID"], exposedHeaders: ["X-Request-ID"] });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, stopAtFirstError: false, exceptionFactory: (errors) => {
    const fieldErrors: Record<string, string[]> = {};
    for (const error of errors) fieldErrors[error.property] = Object.values(error.constraints || {});
    return new ApiException("VALIDATION_ERROR", "The request contains invalid fields.", HttpStatus.BAD_REQUEST, undefined, fieldErrors);
  } }));
  app.useGlobalFilters(new ApiExceptionFilter());
  if (env.SWAGGER_ENABLED && env.NODE_ENV !== "production") {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle("Resume JD Operations API").setVersion("0.8").addBearerAuth({ type: "http", scheme: "bearer", bearerFormat: "Supabase JWT" }).build());
    SwaggerModule.setup("api/docs", app, document);
  }
  return app;
}

export async function bootstrap() {
  const env = environment(), app = await createApiApplication();
  await app.listen(env.PORT);
  const logger = app.get(JsonLogger);
  logger.log("api.started", { port: env.PORT, basePath: env.API_BASE_PATH });
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void bootstrap();
