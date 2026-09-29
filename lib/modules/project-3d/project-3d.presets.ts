import type { Prisma } from "@prisma/client";
import { z } from "zod";

import { AccessError, assertFound } from "@/lib/access/guards";
import { environmentPresetPatch } from "@/lib/3d/shared/environment-presets";
import type { PlatformContext } from "@/lib/context/platform-context";
import { prisma } from "@/lib/database/prisma";
import { assertProject3DPlatformPermission } from "./project-3d.permissions";

/** Platform-wide environment presets for the Experience Editor (Rozaris PresetsPanel). */

const presetName = z.string().trim().min(1).max(80);
export const environmentPresetCreateSchema = z.object({ name: presetName, configuration: z.record(z.string(), z.unknown()) });
export const environmentPresetUpdateSchema = z.object({ name: presetName.optional(), configuration: z.record(z.string(), z.unknown()).optional() });

const select = { id: true, key: true, name: true, configuration: true, updatedAt: true } as const;

function keyOf(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "preset";
  return `${slug}-${Date.now().toString(36)}`;
}

function configurationOf(value: Record<string, unknown>): Prisma.InputJsonValue {
  const patch = environmentPresetPatch(value);
  if (Object.keys(patch).length === 0) throw new AccessError("VALIDATION_ERROR", "The preset has no environment settings.", { configuration: ["The preset has no environment settings."] });
  return patch as unknown as Prisma.InputJsonValue;
}

export async function listEnvironmentPresets(context: PlatformContext) {
  assertProject3DPlatformPermission(context, "platform.3d.configure");
  return prisma.platform3DEnvironmentPreset.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select });
}

export async function createEnvironmentPreset(context: PlatformContext, input: z.infer<typeof environmentPresetCreateSchema>) {
  assertProject3DPlatformPermission(context, "platform.3d.configure");
  return prisma.platform3DEnvironmentPreset.create({
    data: { key: keyOf(input.name), name: input.name, configuration: configurationOf(input.configuration), createdByUserId: context.userId, updatedByUserId: context.userId },
    select,
  });
}

export async function updateEnvironmentPreset(context: PlatformContext, presetId: string, input: z.infer<typeof environmentPresetUpdateSchema>) {
  assertProject3DPlatformPermission(context, "platform.3d.configure");
  const changed = await prisma.platform3DEnvironmentPreset.updateMany({
    where: { id: presetId, isActive: true },
    data: { ...(input.name ? { name: input.name } : {}), ...(input.configuration ? { configuration: configurationOf(input.configuration) } : {}), updatedByUserId: context.userId },
  });
  if (changed.count !== 1) throw new AccessError("NOT_FOUND");
  return assertFound(await prisma.platform3DEnvironmentPreset.findFirst({ where: { id: presetId, isActive: true }, select }));
}

export async function deleteEnvironmentPreset(context: PlatformContext, presetId: string) {
  assertProject3DPlatformPermission(context, "platform.3d.configure");
  const changed = await prisma.platform3DEnvironmentPreset.updateMany({ where: { id: presetId, isActive: true }, data: { isActive: false, updatedByUserId: context.userId } });
  if (changed.count !== 1) throw new AccessError("NOT_FOUND");
  return { id: presetId };
}
