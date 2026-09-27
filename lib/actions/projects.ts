"use server";

import { revalidatePath } from "next/cache";

import { actionFailure, validationFailure, type ActionFailure } from "@/lib/actions/result";
import { requireCompanyContext } from "@/lib/context/current-user";
import {
  addProjectMemberSchema,
  createProjectSchema,
  updateProjectMemberSchema,
  updateProjectSchema,
} from "@/lib/modules/projects/project.schema";
import * as projects from "@/lib/modules/projects/project.service";
import { committed } from "@/lib/forms/committed";

/**
 * Server actions for the Projects module (PRD #8 §127).
 *
 * They are a thin shell over the same service the API routes call — the
 * authorisation, validation and transaction logic exists once (PRD #10 §198).
 */

/**
 * Archiving or editing a project changes what the Projects page and
 * /projects/archived contain, not only the record's own page — so the whole
 * module subtree is revalidated rather than a single path (PRD #10 §235).
 */
function revalidateProjects(projectId?: string) {
  revalidatePath("/projects", "layout");
  if (projectId) revalidatePath(`/projects/${projectId}`, "layout");
  // Dashboard counts read the same records.
  revalidatePath("/dashboard");
}

export type ActionResult = { ok: true; redirectTo?: string } | ActionFailure;

/**
 * The shared failure reading (AUD-09 §3, `lib/actions/result.ts`): a stable
 * code and the field it is about — a client or manager that is not available,
 * a taken code, an end before the start lands beside its input.
 */
function toResult(error: unknown): ActionResult {
  return actionFailure(error, "projects");
}

function formValues(formData: FormData): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

export async function createProjectAction(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();

  const parsed = createProjectSchema.safeParse(formValues(formData));
  if (!parsed.success) return validationFailure(parsed.error);

  let projectId: string;
  try {
    const project = await projects.createProject(context, parsed.data);
    projectId = project.id;
  } catch (error) {
    return toResult(error);
  }

  revalidateProjects(projectId);
  return committed(`/projects/${projectId}`);
}

export async function updateProjectAction(
  projectId: string,
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireCompanyContext();

  const parsed = updateProjectSchema.safeParse(formValues(formData));
  if (!parsed.success) return validationFailure(parsed.error);

  try {
    await projects.updateProject(context, projectId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateProjects(projectId);
  return committed(`/projects/${projectId}`);
}

export async function archiveProjectAction(projectId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();

  try {
    await projects.archiveProject(context, projectId);
  } catch (error) {
    return toResult(error);
  }

  revalidateProjects(projectId);
  return { ok: true };
}

export async function restoreProjectAction(projectId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();

  try {
    await projects.restoreProject(context, projectId);
  } catch (error) {
    return toResult(error);
  }

  revalidateProjects(projectId);
  return { ok: true };
}

export async function addProjectMemberAction(
  projectId: string,
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireCompanyContext();

  const parsed = addProjectMemberSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return validationFailure(parsed.error, "Select a team member to add.");
  }

  try {
    await projects.addMember(context, projectId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateProjects(projectId);
  return { ok: true };
}

export async function updateProjectMemberAction(
  projectId: string,
  projectMemberId: string,
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireCompanyContext();

  const parsed = updateProjectMemberSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return validationFailure(parsed.error, "That project role is not valid.");
  }

  try {
    await projects.updateMember(context, projectId, projectMemberId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateProjects(projectId);
  return { ok: true };
}

export async function removeProjectMemberAction(
  projectId: string,
  projectMemberId: string,
): Promise<ActionResult> {
  const context = await requireCompanyContext();

  try {
    await projects.removeMember(context, projectId, projectMemberId);
  } catch (error) {
    return toResult(error);
  }

  revalidateProjects(projectId);
  return { ok: true };
}
