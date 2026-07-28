import type { Request } from "express";
import type { AuthenticatedUser } from "@resume-jd/contracts";

export interface ApiRequest extends Request {
  requestId: string;
  user?: AuthenticatedUser;
  accessContext?: { status: string; roles: string[] };
}
