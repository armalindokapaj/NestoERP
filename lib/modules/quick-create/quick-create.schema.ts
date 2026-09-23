import { z } from "zod";

/** Quick Create inputs (Quick Create PRD §90, §93). Ids are candidates only; the service reads each again. */
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const pathname = z.string().max(300).startsWith("/");

export const quickCreateMenuQuerySchema = z.object({ pathname: pathname.optional() });
export const quickCreateLaunchSchema = z.object({ actionKey: z.string().max(80), companyId: id.nullish(), projectId: id.nullish(), pathname: pathname.nullish() });
export const quickCreateProjectsQuerySchema = z.object({ actionKey: z.string().max(80), companyId: id.optional() });
