import type { ProjectMediaType } from "@prisma/client";

export type ProjectMediaDTO = {
  id: string;
  type: ProjectMediaType;
  title: string;
  description: string | null;
  durationSeconds: number | null;
  sortOrder: number;
  isCover: boolean;
  isFeatured: boolean;
  thumbnailDocumentId: string | null;
  document: {
    id: string;
    name: string;
    mimeType: string | null;
  };
  thumbnailUrl: string | null;
  contentUrl: string;
  createdAt: string;
};

export type ProjectMediaCollection = {
  renders: ProjectMediaDTO[];
  animations: ProjectMediaDTO[];
  counts: { renders: number; animations: number };
  cover: ProjectMediaDTO | null;
  capabilities: { canView: boolean; canManage: boolean; canUpload: boolean };
};
