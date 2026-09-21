import { AccessError } from "@/lib/access/guards";
import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { project3DStructureDeleteSchema, project3DStructureUpdateSchema } from "@/lib/modules/project-3d/project-3d.schema";
import { deletePlatformProjectStructure, updatePlatformProjectStructure } from "@/lib/modules/project-3d/project-3d.structure";

type RouteParams = { params: Promise<{ projectId: string; kind: string; recordId: string }> };
const KINDS = ["building", "floor", "unit"] as const;

function structureKind(value: string): (typeof KINDS)[number] {
  const kind = KINDS.find((candidate) => candidate === value);
  if (!kind) throw new AccessError("NOT_FOUND");
  return kind;
}

export async function PATCH(request: Request, { params }: RouteParams) {
  return withPlatformContext(async (context) => {
    const { projectId, kind: rawKind, recordId } = await params;
    const kind = structureKind(rawKind);
    const input = project3DStructureUpdateSchema.parse({ ...(await readJson(request)), kind });
    return apiOk({ data: await updatePlatformProjectStructure(context, projectId, recordId, input) });
  });
}

export async function DELETE(request: Request, { params }: RouteParams) {
  return withPlatformContext(async (context) => {
    const { projectId, kind: rawKind, recordId } = await params;
    const kind = structureKind(rawKind);
    const { reason } = project3DStructureDeleteSchema.parse(await readJson(request));
    return apiOk({ data: await deletePlatformProjectStructure(context, projectId, kind, recordId, reason) });
  });
}
