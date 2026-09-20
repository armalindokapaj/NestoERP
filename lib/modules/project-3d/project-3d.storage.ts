import { assertKeyBelongsToCompany, isWellFormedKey } from "@/lib/core/storage/storage-provider";

export type Project3DStorageKind = "source" | "runtime" | "derived";

function opaqueId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

export function buildProject3DStorageKey(input: {
  companyId: string;
  projectId: string;
  kind: Project3DStorageKind;
  extension: string;
  objectId?: string;
}): string {
  const extension = input.extension.toLowerCase().replace(/[^a-z0-9]/g, "");
  const leaf = input.objectId ?? opaqueId();
  const key = `companies/${input.companyId}/projects/${input.projectId}/3d/${input.kind}/${leaf}${extension ? `.${extension}` : ""}`;
  assertProject3DStorageKey(key, input.companyId, input.projectId, input.kind);
  return key;
}

export function assertProject3DStorageKey(storageKey: string, companyId: string, projectId: string, kind?: Project3DStorageKind): void {
  assertKeyBelongsToCompany(storageKey, companyId);
  if (!isWellFormedKey(storageKey)) throw new Error("Refusing a malformed Project 3D storage key.");
  const expected = `companies/${companyId}/projects/${projectId}/3d/${kind ? `${kind}/` : ""}`;
  if (!storageKey.startsWith(expected)) throw new Error("Refusing a Project 3D storage key outside the Project prefix.");
}

