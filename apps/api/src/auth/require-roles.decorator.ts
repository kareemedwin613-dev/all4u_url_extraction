import { SetMetadata } from "@nestjs/common";
import type { SystemRole } from "@resume-jd/contracts";
export const REQUIRED_ROLES = "requiredRoles";
export const RequireRoles = (...roles: SystemRole[]) => SetMetadata(REQUIRED_ROLES, roles);
