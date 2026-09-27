import type { dashboardEn } from "./en";
import { dashboardConfigSq } from "./config-sq";

export const dashboardSq: typeof dashboardEn = {
  ...dashboardConfigSq,
  title: "Paneli",
  across: "Në të gjithë {name}",
  viewAll: "Shiko të gjitha",
  loadFailed: "Ky seksion nuk u ngarkua dot. Rifreskoni faqen për të provuar sërish.",
  progress: "Progresi",
  progressOf: "Progresi i {name}",
  type: "Lloji",
  group: "Grupi",
  activeCompanies_one: "{count} kompani aktive",
  activeCompanies_other: "{count} kompani aktive",
  suspended: "{count} të pezulluara",
  demoDisclaimer: "Mjedis demonstrues — informacion publik për kompanitë dhe projektet i kombinuar me të dhëna operacionale sintetike.",
  viewByCompany: "Shiko sipas kompanisë",
  partNotLoaded: "Një pjesë e kësaj nuk u ngarkua dot",
  startHere: "Fillo këtu",
  hideStartHere: "Fshih Fillo këtu",
  nothingShared:
    "Ende nuk është ndarë asgjë me ju këtu. Projektet dhe detyrat shfaqen në këtë panel kur një koleg ju shton në një projekt ose ju cakton punë.",
};
