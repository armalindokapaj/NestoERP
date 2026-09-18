import type { PrismaClient } from "@prisma/client";

/**
 * The work profiles colleagues read (E-01 §14, §18; ADR 0002).
 *
 * A handful of demo people fill in what a person keeps on their own profile —
 * a short bio, their extension, where to find them — so the directory and the
 * profile show both the filled and the empty state. Nothing here is private:
 * personal contact details stay HR's (the recruitment seed has a candidate's).
 */
const WORK_PROFILES: Record<string, { professionalBio: string; workPhoneExtension: string; officeLocation: string }> = {
  person_owner: {
    professionalBio: "Founded the group's first company in 2009 and chairs the five that make it up today.",
    workPhoneExtension: "100",
    officeLocation: "Tiranë HQ, 5th floor",
  },
  person_hr: {
    professionalBio: "Leads people operations across the group: recruitment, onboarding and every employment record.",
    workPhoneExtension: "140",
    officeLocation: "Tiranë HQ, 4th floor",
  },
  person_architecture_manager: {
    professionalBio: "Heads Group Architecture and manages Aurelia's studio; design reviews on Tuesdays.",
    workPhoneExtension: "310",
    officeLocation: "Tiranë HQ, 2nd floor",
  },
  person_pm: {
    professionalBio: "Runs Riverside Residences from design freeze to handover.",
    workPhoneExtension: "214",
    officeLocation: "Riverside site office",
  },
  person_ceo_b: {
    professionalBio: "Leads Meridian Developments and the Central Office Tower programme.",
    workPhoneExtension: "200",
    officeLocation: "Durrës office",
  },
  person_engineer_c: {
    professionalBio: "Civil engineer on East Gate Logistics Hub: earthworks, drainage and pavements.",
    workPhoneExtension: "420",
    officeLocation: "East Gate site office",
  },
};

export async function seedWorkProfiles(prisma: PrismaClient): Promise<number> {
  for (const [id, profile] of Object.entries(WORK_PROFILES)) {
    await prisma.personProfile.update({ where: { id }, data: profile });
  }
  return Object.keys(WORK_PROFILES).length;
}
