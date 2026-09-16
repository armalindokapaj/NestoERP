import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { updateProjectTypeSchema } from "@/lib/modules/projects/project.schema";
import { deleteProjectType, updateProjectType } from "@/lib/modules/projects/project-type.service";

type Params = { params: Promise<{ typeId: string }> };

/**
 * PATCH  /api/projects/types/:typeId — rename, retire or bring back (E-05A §62).
 * DELETE /api/projects/types/:typeId — only a type no project uses.
 *
 * A type in another company answers 404, the same as one that does not exist.
 */
export async function PATCH(request: Request, { params }: Params) {
  const { typeId } = await params;
  return withContext(async (context) => {
    const input = updateProjectTypeSchema.parse(await readJson(request));
    return apiOk({ data: await updateProjectType(context, typeId, input) });
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { typeId } = await params;
  return withContext(async (context) => {
    await deleteProjectType(context, typeId);
    return apiOk({ data: { deleted: true } });
  });
}
