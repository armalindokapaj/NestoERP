import { apiOk, withContext } from "@/lib/api/respond";

/**
 * GET /api/me — the current user context (PRD #6 §32, §33).
 *
 * Returns identity, company, role, permissions and module access in one
 * request, so the client never has to chain calls to learn who it is
 * (PRD #6 §123). Password hashes, session tokens and other security metadata
 * are never included (PRD #8 §119).
 */
export async function GET() {
  return withContext(async (context) =>
    apiOk({
      user: {
        id: context.userId,
        firstName: context.firstName,
        lastName: context.lastName,
        email: context.email,
        avatarUrl: context.avatarUrl,
        jobTitle: context.jobTitle,
      },
      company: {
        id: context.company.id,
        name: context.company.name,
        slug: context.company.slug,
      },
      department: context.department,
      role: context.role,
      permissions: context.permissions,
      moduleAccess: Object.fromEntries(
        Object.values(context.moduleAccess)
          .filter((access) => access.enabled && access.accessLevel !== "NONE")
          .map((access) => [
            access.module,
            { accessLevel: access.accessLevel, scope: access.scope },
          ]),
      ),
      enabledModules: context.enabledModules,
    }),
  );
}
