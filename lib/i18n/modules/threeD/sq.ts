import type { threeDEn } from "./en";

export const threeDSq: typeof threeDEn = {
  meta: {
    viewer: "Shikuesi 3D",
    explorer: "Eksploruesi 3D",
  },
  labels: {
    placeholderKind: {
      interior: "brendësi",
      facade: "fasadë",
      floorplan: "planimetri",
      hero: "kryesore",
      avatar: "avatar",
      gallery: "galeri",
      video: "video",
    },
  },
  page: {
    opening: "Po hapet shikuesi 3D",
    openFailed: "Shikuesi 3D nuk mund të hapej.",
    releaseUnreadable: "Publikimi 3D nuk mund të lexohej.",
    noExperience: "Nuk ka asnjë eksperiencë 3D të publikuar.",
    backToProject: "Kthehu te projekti",
    tryAgain: "Provo përsëri",
    modelsFailed: "Një ose më shumë modele të publikuara nuk mund të ngarkoheshin.",
    modelAccessExpired: "Qasja e nënshkruar te modelet mund të ketë skaduar.",
    affected: "Të prekura: {models}",
    retry: "Riprovo",
    noLongerAvailable: "Kjo përvojë 3D nuk është më e disponueshme.",
    updatedTitle: "Është i disponueshëm një version më i ri i kësaj përvoje 3D.",
    reload: "Ringarko",
    loginTitle: "Hyni për të parë këtë përvojë 3D",
    loginBody: "Vetëm përdoruesit e identifikuar me qasje në këtë kompani dhe projekt mund ta shohin.",
    signIn: "Hyr",
    unavailableTitle: "Kjo përvojë 3D nuk është e disponueshme",
    unavailableBody: "Lidhja mund të ketë ndryshuar, ose përvoja është jashtë linje.",
    previewBadge: "Parapamje publike",
  },
  renderer: {
    cannotDisplay: "Kjo pajisje nuk mund ta shfaqë shikuesin 3D.",
    interrupted: "Pamja 3D u ndërpre nga drejtuesi grafik i kësaj pajisjeje.",
    reload: "Ringarko",
  },
  hud: {
    backTo: "Kthehu te {project}",
    rangeMinimum: "{label} minimumi",
    rangeMaximum: "{label} maksimumi",
    placeholderImage: "Imazh zëvendësues: {kind}",
  },
};
