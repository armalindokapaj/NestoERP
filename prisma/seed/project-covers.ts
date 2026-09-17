import type { PrismaClient } from "@prisma/client";
import sharp from "sharp";

import { FIXTURE_PROJECTS, FIXTURE_TENANT, PROJECT_IDS, companyOfProject, type SeedMembers } from "./constants";
import { seedStoredDocument } from "./document-objects";

/**
 * Cover renders for the demo projects (E-05A §7, §8).
 *
 * Drawn here rather than shipped as files: a handful of flat architectural
 * elevations, generated as JPEGs and stored through the same document path a
 * real upload leaves behind, so the Projects page shows covers, placeholders,
 * and the thumbnail pipeline between them. Riverside Residences is left
 * without one on purpose — the documents suite picks among its files — and so
 * is East Gate Logistics Hub, so the placeholder is on the page too.
 */

type Mass = { x: number; w: number; h: number; fill: string; glass: string; cols: number; rows: number };
type Scene = { sky: [string, string]; ground: string; sun?: { cx: number; cy: number; r: number; fill: string }; water?: string; masses: Mass[] };

const WIDTH = 1200;
const HEIGHT = 1600;
const HORIZON = 1180;

function svgFor(scene: Scene): string {
  const masses = scene.masses
    .map((mass) => {
      const top = HORIZON - mass.h;
      const padX = mass.w * 0.12;
      const padY = 36;
      const cellW = (mass.w - padX * 2) / mass.cols;
      const cellH = (mass.h - padY * 2) / mass.rows;
      const windows: string[] = [];
      for (let row = 0; row < mass.rows; row += 1) {
        for (let col = 0; col < mass.cols; col += 1) {
          windows.push(
            `<rect x="${(mass.x + padX + col * cellW + cellW * 0.14).toFixed(1)}" y="${(top + padY + row * cellH + cellH * 0.18).toFixed(1)}" width="${(cellW * 0.72).toFixed(1)}" height="${(cellH * 0.64).toFixed(1)}" fill="${mass.glass}" opacity="${(0.55 + ((row * 7 + col * 3) % 5) * 0.08).toFixed(2)}"/>`,
          );
        }
      }
      return `<rect x="${mass.x}" y="${top}" width="${mass.w}" height="${mass.h}" fill="${mass.fill}"/>${windows.join("")}<rect x="${mass.x}" y="${top}" width="${mass.w}" height="10" fill="#000" opacity="0.08"/>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${scene.sky[0]}"/><stop offset="1" stop-color="${scene.sky[1]}"/></linearGradient></defs>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#sky)"/>
    ${scene.sun ? `<circle cx="${scene.sun.cx}" cy="${scene.sun.cy}" r="${scene.sun.r}" fill="${scene.sun.fill}" opacity="0.85"/>` : ""}
    ${masses}
    <rect y="${HORIZON}" width="${WIDTH}" height="${HEIGHT - HORIZON}" fill="${scene.ground}"/>
    ${scene.water ? `<rect y="${HORIZON + 120}" width="${WIDTH}" height="${HEIGHT - HORIZON - 120}" fill="${scene.water}" opacity="0.9"/>` : ""}
  </svg>`;
}

const COVERS: Array<{ id: string; companyId: string; projectId: string; name: string; uploadedBy: string; createdBy: string; scene: Scene }> = [
  {
    id: "doc_render_central_office_tower",
    companyId: companyOfProject(PROJECT_IDS.b),
    projectId: PROJECT_IDS.b,
    name: "Central Office Tower render.jpg",
    uploadedBy: "user_pm",
    createdBy: "user_pm",
    scene: {
      sky: ["#9fb7c9", "#e3e8e6"],
      ground: "#6e7470",
      masses: [
        { x: 120, w: 260, h: 520, fill: "#8a9197", glass: "#c9d6de", cols: 4, rows: 9 },
        { x: 420, w: 380, h: 1000, fill: "#3f4a54", glass: "#9cc3da", cols: 6, rows: 18 },
        { x: 840, w: 250, h: 640, fill: "#7c858c", glass: "#c3d2db", cols: 4, rows: 11 },
      ],
    },
  },
  {
    id: "doc_render_marina_apartments",
    companyId: companyOfProject(PROJECT_IDS.d),
    projectId: PROJECT_IDS.d,
    name: "Marina Apartments render.jpg",
    uploadedBy: "user_architect",
    createdBy: "user_architect",
    scene: {
      sky: ["#e7b58f", "#f6e6d2"],
      ground: "#d9cdb8",
      water: "#5d8aa0",
      sun: { cx: 880, cy: 420, r: 110, fill: "#f9d9a8" },
      masses: [
        { x: 80, w: 330, h: 520, fill: "#f2ede4", glass: "#7f9aa8", cols: 5, rows: 7 },
        { x: 440, w: 300, h: 660, fill: "#ebe3d6", glass: "#6f8d9c", cols: 4, rows: 9 },
        { x: 770, w: 350, h: 460, fill: "#f4efe7", glass: "#86a1ae", cols: 5, rows: 6 },
      ],
    },
  },
  {
    id: "doc_render_adriatic_hotel",
    companyId: companyOfProject(PROJECT_IDS.e),
    projectId: PROJECT_IDS.e,
    name: "Adriatic Hotel render.jpg",
    uploadedBy: "user_pm",
    createdBy: "user_pm",
    scene: {
      sky: ["#b9c6cf", "#eef0ec"],
      ground: "#8b8f88",
      masses: [
        { x: 60, w: 1080, h: 340, fill: "#c9bfae", glass: "#40505c", cols: 12, rows: 3 },
        { x: 380, w: 440, h: 520, fill: "#b3a896", glass: "#4a5a66", cols: 6, rows: 5 },
      ],
    },
  },
  {
    id: "doc_render_isarvorstadt_studio",
    companyId: FIXTURE_TENANT,
    projectId: FIXTURE_PROJECTS.tenantTwo,
    name: "Isarvorstadt facade study.jpg",
    uploadedBy: "user_owner_b",
    createdBy: "user_owner_b",
    scene: {
      sky: ["#c7cfd6", "#f1efe9"],
      ground: "#9a948a",
      masses: [
        { x: 140, w: 420, h: 760, fill: "#b4654a", glass: "#e9e1d3", cols: 4, rows: 6 },
        { x: 600, w: 460, h: 820, fill: "#d8cbb3", glass: "#56636c", cols: 4, rows: 7 },
      ],
    },
  },
  {
    id: "doc_render_munich_workspace",
    companyId: FIXTURE_TENANT,
    projectId: FIXTURE_PROJECTS.tenantOne,
    name: "Munich workspace render.jpg",
    uploadedBy: "user_owner_b",
    createdBy: "user_owner_b",
    scene: {
      sky: ["#a9bfcf", "#e8ecec"],
      ground: "#707670",
      masses: [
        { x: 100, w: 1000, h: 700, fill: "#dcdcd6", glass: "#5b7382", cols: 10, rows: 8 },
      ],
    },
  },
];

export async function seedProjectCovers(prisma: PrismaClient, members: SeedMembers) {
  for (const cover of COVERS) {
    const bytes = await sharp(Buffer.from(svgFor(cover.scene))).jpeg({ quality: 82 }).toBuffer();
    await seedStoredDocument(prisma, {
      id: cover.id,
      companyId: cover.companyId,
      name: cover.name,
      description: "Cover render for the Projects page.",
      projectId: cover.projectId,
      uploadedByMemberId: members.in(cover.companyId, cover.uploadedBy),
      createdBy: members.userIn(cover.companyId, cover.createdBy),
      bytes: new Uint8Array(bytes),
    });
    // A re-seed rebuilds the render, so its thumbnail is rebuilt from it too.
    await prisma.document.update({ where: { id: cover.id }, data: { thumbnailStorageKey: null } });
    await prisma.project.update({ where: { id: cover.projectId }, data: { coverImageDocumentId: cover.id } });
  }
}
