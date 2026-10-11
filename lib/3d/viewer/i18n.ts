"use client";

import { useCallback } from "react";

import type { Locale } from "@/lib/i18n/config";
import { useViewerStore } from "@/lib/3d/viewer/store";

/*
 * The Project viewer's copy, taken verbatim from the Rozaris viewer
 * dictionaries (English and Albanian). Only the keys the viewer reads are kept.
 * NESTO's own dictionaries stay untouched: the viewer is one immersive surface
 * with its own vocabulary, and its language follows the reader's NESTO choice.
 */
const en = {
  "more": {
    "projectInformation": "Project Information",
    "share": "Share",
    "settings": "Settings",
    "help": "Help",
    "exitViewer": "Exit Viewer",
    "back": "Back",
    "viewProjectPage": "View Project Page",
    "completion": "Completion",
    "verified": "Verified",
    "copyLink": "Copy Link",
    "linkCopied": "Link copied",
    "shareWhatsApp": "WhatsApp",
    "shareEmail": "Email",
    "settingsLanguage": "Language",
    "settingsAreaUnits": "Area Units",
    "settingsCurrency": "Currency",
    "settingsQuality": "Quality",
    "settingsReducedMotion": "Reduced Motion",
    "settingsAutoHide": "Interface Auto-hide",
    "settingsReset": "Reset Viewer Preferences",
    "quality": {
      "auto": "Automatic",
      "max": "Max",
      "high": "High",
      "medium": "Medium",
      "low": "Low"
    },
    "on": "On",
    "off": "Off",
    "helpDrag": "Drag",
    "helpDragAction": "Rotate",
    "helpSwipe": "Swipe",
    "helpScroll": "Scroll / Pinch",
    "helpZoomAction": "Zoom",
    "helpClick": "Click Unit",
    "helpTap": "Tap Unit",
    "helpSelectAction": "Select",
    "propertyType": {
      "apartment": "Residential Development",
      "house": "House Development",
      "villa": "Villa Development",
      "studio": "Studio Development",
      "land": "Land Development",
      "commercial": "Commercial Development",
      "office": "Office Development"
    }
  },
  "viewer": {
    "explore": "Explore",
    "units": "Units",
    "views": "Views",
    "sunTime": "Time",
    "more": "More",
    "moreProjectInfo": "Project Information",
    "moreShare": "Share",
    "moreLanguage": "Language",
    "moreHelp": "Help",
    "moreResetView": "Reset View",
    "moreExitViewer": "Exit Viewer",
    "moreComingSoon": "More options are coming soon.",
    "moduleComingSoonBody": "This module will be available in an upcoming update.",
    "dragToExplore": "Drag to explore",
    "swipeToExplore": "Swipe to explore"
  },
  "units": {
    "status": {
      "available": "Available",
      "reserved": "Reserved",
      "sold": "Sold",
      "all": "All"
    },
    "sort": {
      "recommended": "Sort: Recommended",
      "priceAsc": "Price: Low to high",
      "priceDesc": "Price: High to low",
      "areaAsc": "Area: Small to large",
      "areaDesc": "Area: Large to small",
      "floorAsc": "Floor: Low to high",
      "floorDesc": "Floor: High to low"
    },
    "detail": {
      "floor": "Floor",
      "type": "Type",
      "area": "Area",
      "bathrooms": "Bathrooms",
      "floorPlan": "Floor plan",
      "contact": "Contact developer"
    },
    "advancedFilters": "Advanced filters",
    "backToSearch": "Back to search",
    "clearFilters": "Clear filters",
    "clearSelection": "Clear selection",
    "close": "Close",
    "favorite": "Favorite",
    "filterBathrooms": "Bathrooms",
    "filterBedrooms": "Bedrooms",
    "filterBuilding": "Building",
    "filterFloor": "Floor",
    "filterListLabel": "Filter List",
    "filterPrice": "Price",
    "filterRooms": "Rooms",
    "filterSurface": "Surface",
    "filtersToggle": "Filters",
    "floorLabel": "Floor {floor}",
    "foundCount": "{count} units found",
    "listUnits": "List units",
    "loadMore": "Load more",
    "max": "Max",
    "min": "Min",
    "moreComingSoon": "Coming in an upcoming update.",
    "noResults": "No units match these filters.",
    "notInModel": "Not shown in the 3D model",
    "rangeMaximum": "{label} maximum",
    "rangeMinimum": "{label} minimum",
    "resultsCount": "{count} results",
    "searchPlaceholder": "Search unit, floor, type...",
    "showingRange": "Showing {shown} of {total}",
    "title": "Units",
    "viewDetails": "Details",
    "viewGrid": "Grid view",
    "viewList": "List view"
  },
  "sunTime": {
    "title": "Sun & Time",
    "reset": "Reset",
    "chooseDate": "Choose date",
    "sunrise": "Sunrise",
    "sunset": "Sunset",
    "periodNight": "Night",
    "periodSunrise": "Sunrise",
    "periodMorning": "Morning",
    "periodAfternoon": "Afternoon",
    "periodEvening": "Evening",
    "periodSunset": "Sunset",
    "presets": "Presets",
    "presetMorning": "Morning",
    "presetNoon": "Noon",
    "presetGoldenHour": "Golden Hour",
    "presetEvening": "Evening",
    "readOnlyHint": "Time is set by the project — live scrubbing isn't enabled here yet."
  },
  "views": {
    "empty": "No camera views published yet."
  },
  "common": {
    "any": "Any",
    "cancel": "Cancel",
    "close": "Close"
  },
  "compare": {
    "removeFromCompare": "Remove {title} from compare",
    "removeFromCompareShort": "Remove from compare",
    "button": "Compare {count}/2",
    "title": "Compare properties",
    "closeComparison": "Close comparison",
    "hintNone": "Select up to two listings or units to compare using the compare icon on any card.",
    "hintOne": "Add one more listing or unit to complete your comparison.",
    "replaceTitle": "Compare up to 2 properties",
    "replaceBody": "Choose which one to replace with {title}.",
    "replaceThis": "Replace this"
  },
  "filters": {
    "bathrooms": "Bathrooms",
    "countPlus": "{count}+",
    "priceRangeAria": "Price range",
    "priceShort": "Price",
    "resetAllFilters": "Reset all filters"
  },
  "gallery": {
    "goToPhoto": "Go to photo {n}",
    "nextPhoto": "Next photo",
    "playVideo": "Play video tour",
    "prevPhoto": "Previous photo",
    "tabFacade": "Facade / unit location",
    "tabFloorplan": "Floor plan",
    "tabPhotos": "Photos",
    "tabVideo": "Video"
  },
  "listing": {
    "contactPublisher": "Contact the publisher",
    "inCompare": "In compare"
  },
  "nav": {
    "compare": "Compare"
  },
  "project": {
    "constructionProgress": "Construction progress",
    "fullscreenUnavailable": "Fullscreen isn't available in this window",
    "northSign": "Reset to North",
    "progress": "Progress",
    "screenshot": "Screenshot",
    "screenshotFailed": "Couldn't capture a screenshot — try again",
    "screenshotSaved": "Screenshot saved",
    "scrubTimeline": "Scrub construction timeline"
  },
  "projectDetail": {
    "priceOnRequest": "Price on request"
  },
  "publisher": {
    "call": "Call",
    "typeAgency": "Agency",
    "typeDeveloper": "Developer",
    "typePrivateOwner": "Private Owner",
    "whatsapp": "WhatsApp"
  },
  "results": {
    "viewUnit": "View Unit"
  },
  "unit": {
    "allBuildings": "All buildings",
    "anyBeds": "Any beds",
    "availableUnitsTitle": "Available units",
    "bedPlus": "{count}+ bed",
    "buildingLabel": "Building {name}",
    "closeUnitDiscovery": "Close unit discovery",
    "collapseUnitDetail": "Show less",
    "designThisApartment": "Design this Apartment",
    "exitFloorView": "Exit Floor",
    "exitFloorViewTitle": "Close the floor {n} cut",
    "floorLabel": "Floor {n}",
    "floorRailHeading": "Floor",
    "floorRailLabel": "Floor navigation",
    "floorRailNoSection": "No floor cut has been drawn for floor {n} yet",
    "floorRailNoSectionShort": "no cut yet",
    "floorRailUnits": "{count} units",
    "floorRailUnitsOne": "1 unit",
    "noUnitsMatch": "No units match these filters yet.",
    "openRecord": "Open unit record",
    "orientation": "Orientation",
    "orientationE": "E — East",
    "orientationN": "N — North",
    "orientationS": "S — South",
    "orientationW": "W — West",
    "requestSent": "Request sent",
    "saveProject": "Save project",
    "savedProject": "Saved",
    "statusAvailable": "available",
    "statusReserved": "reserved",
    "statusSold": "sold",
    "typeCommercial": "Commercial",
    "typeLabel": "Type",
    "typeParking": "Parking",
    "typeResidential": "Residential",
    "typeStorage": "Storage",
    "unitsMatch": "{matched} of {total} units match",
    "viewInFloor": "View in Floor",
    "viewInFloorTitle": "Cut the building open at floor {n}",
    "viewerBuilding": "Building",
    "viewerFilterAll": "All",
    "viewerFullscreen": "Toggle fullscreen",
    "whatsappInterest": "Hi, I'm interested in unit {code} at {project}"
  },
  "compareFields": {
    "price": "Price",
    "pricePerSqm": "Price / m²",
    "area": "Area",
    "bedrooms": "Bedrooms",
    "bathrooms": "Bathrooms",
    "floor": "Floor",
    "propertyType": "Property type",
    "transaction": "Transaction",
    "parking": "Parking",
    "balconyTerrace": "Balcony / terrace",
    "furnished": "Furnished",
    "neighborhood": "Neighborhood",
    "publisher": "Publisher",
    "availability": "Availability",
    "yes": "Yes",
    "no": "No",
    "available": "Available",
    "projectUnit": "Project unit"
  }
};

export type ViewerDictionary = typeof en;

const sq: ViewerDictionary = {
  "more": {
    "projectInformation": "Rreth Projektit",
    "share": "Ndaj",
    "settings": "Cilësimet",
    "help": "Ndihmë",
    "exitViewer": "Dil nga Shikuesi",
    "back": "Kthehu",
    "viewProjectPage": "Shiko Faqen e Projektit",
    "completion": "Përfundimi",
    "verified": "I verifikuar",
    "copyLink": "Kopjo Linkun",
    "linkCopied": "Linku u kopjua",
    "shareWhatsApp": "WhatsApp",
    "shareEmail": "Email",
    "settingsLanguage": "Gjuha",
    "settingsAreaUnits": "Njësitë e Sipërfaqes",
    "settingsCurrency": "Monedha",
    "settingsQuality": "Cilësia",
    "settingsReducedMotion": "Lëvizje e Reduktuar",
    "settingsAutoHide": "Fshehje Automatike e Ndërfaqes",
    "settingsReset": "Rivendos Preferencat e Shikuesit",
    "quality": {
      "auto": "Automatike",
      "max": "Maksimale",
      "high": "E lartë",
      "medium": "Mesatare",
      "low": "E ulët"
    },
    "on": "Ndezur",
    "off": "Fikur",
    "helpDrag": "Tërhiq",
    "helpDragAction": "Rrotullo",
    "helpSwipe": "Rrëshqit",
    "helpScroll": "Rrotullo / Piko me gishta",
    "helpZoomAction": "Zmadho",
    "helpClick": "Kliko Njësinë",
    "helpTap": "Prek Njësinë",
    "helpSelectAction": "Zgjidh",
    "propertyType": {
      "apartment": "Zhvillim Rezidencial",
      "house": "Zhvillim me Shtëpi",
      "villa": "Zhvillim me Vila",
      "studio": "Zhvillim me Studio",
      "land": "Zhvillim Tokash",
      "commercial": "Zhvillim Komercial",
      "office": "Zhvillim me Zyra"
    }
  },
  "viewer": {
    "explore": "Eksploro",
    "units": "Njësi",
    "views": "Pamje",
    "sunTime": "Koha",
    "more": "Më shumë",
    "moreProjectInfo": "Rreth Projektit",
    "moreShare": "Ndaj",
    "moreLanguage": "Gjuha",
    "moreHelp": "Ndihmë",
    "moreResetView": "Rivendos Pamjen",
    "moreExitViewer": "Dil nga Shikuesi",
    "moreComingSoon": "Më shumë opsione së shpejti.",
    "moduleComingSoonBody": "Ky modul do të jetë i disponueshëm në një përditësim të ardhshëm.",
    "dragToExplore": "Tërhiq për të eksploruar",
    "swipeToExplore": "Rrëshqit për të eksploruar"
  },
  "units": {
    "status": {
      "available": "Disponueshme",
      "reserved": "Rezervuar",
      "sold": "Shitur",
      "all": "Të gjitha"
    },
    "sort": {
      "recommended": "Rendit: Rekomanduar",
      "priceAsc": "Çmimi: Nga i ulëti tek i larti",
      "priceDesc": "Çmimi: Nga i larti tek i ulëti",
      "areaAsc": "Sipërfaqja: Nga më e vogla tek më e madhja",
      "areaDesc": "Sipërfaqja: Nga më e madhja tek më e vogla",
      "floorAsc": "Kati: Nga më i ulëti tek më i larti",
      "floorDesc": "Kati: Nga më i larti tek më i ulëti"
    },
    "detail": {
      "floor": "Kati",
      "type": "Tipi",
      "area": "Sipërfaqja",
      "bathrooms": "Banjo",
      "floorPlan": "Planimetria",
      "contact": "Kontakto zhvilluesin"
    },
    "advancedFilters": "Filtra të avancuar",
    "backToSearch": "Kthehu te kërkimi",
    "clearFilters": "Pastro filtrat",
    "clearSelection": "Hiq zgjedhjen",
    "close": "Mbyll",
    "favorite": "Shto te të preferuarat",
    "filterBathrooms": "Banjo",
    "filterBedrooms": "Dhoma gjumi",
    "filterBuilding": "Ndërtesa",
    "filterFloor": "Kati",
    "filterListLabel": "Lista e Filtrave",
    "filterPrice": "Çmimi",
    "filterRooms": "Dhoma",
    "filterSurface": "Sipërfaqja",
    "filtersToggle": "Filtra",
    "floorLabel": "Kati {floor}",
    "foundCount": "{count} njësi u gjetën",
    "listUnits": "Listo njësitë",
    "loadMore": "Ngarko më shumë",
    "max": "Maks",
    "min": "Min",
    "moreComingSoon": "Vjen në një përditësim të ardhshëm.",
    "noResults": "Asnjë njësi nuk përputhet me këta filtra.",
    "notInModel": "Nuk shfaqet në modelin 3D",
    "rangeMaximum": "{label}: maksimumi",
    "rangeMinimum": "{label}: minimumi",
    "resultsCount": "{count} rezultate",
    "searchPlaceholder": "Kërko njësi, kat, tip...",
    "showingRange": "Duke shfaqur {shown} nga {total}",
    "title": "Njësi",
    "viewDetails": "Detajet",
    "viewGrid": "Pamje rrjetë",
    "viewList": "Pamje listë"
  },
  "sunTime": {
    "title": "Dielli & Koha",
    "reset": "Rivendos",
    "chooseDate": "Zgjidh datën",
    "sunrise": "Lindja e diellit",
    "sunset": "Perëndimi i diellit",
    "periodNight": "Natë",
    "periodSunrise": "Lindja e diellit",
    "periodMorning": "Mëngjes",
    "periodAfternoon": "Pasdite",
    "periodEvening": "Mbrëmje",
    "periodSunset": "Perëndimi i diellit",
    "presets": "Paracaktime",
    "presetMorning": "Mëngjes",
    "presetNoon": "Mesditë",
    "presetGoldenHour": "Ora e Artë",
    "presetEvening": "Mbrëmje",
    "readOnlyHint": "Koha caktohet nga projekti — rregullimi i drejtpërdrejtë nuk është aktivizuar ende këtu."
  },
  "views": {
    "empty": "Ende nuk ka pamje kamerash të publikuara."
  },
  "common": {
    "any": "Të gjitha",
    "cancel": "Anulo",
    "close": "Mbyll"
  },
  "compare": {
    "removeFromCompare": "Hiq {title} nga krahasimi",
    "removeFromCompareShort": "Hiq nga krahasimi",
    "button": "Krahaso {count}/2",
    "title": "Krahaso pronat",
    "closeComparison": "Mbyll krahasimin",
    "hintNone": "Zgjidh deri në dy prona ose njësi për të krahasuar duke përdorur ikonën e krahasimit tek çdo kartë.",
    "hintOne": "Shto edhe një pronë ose njësi për të përfunduar krahasimin.",
    "replaceTitle": "Krahaso deri në 2 prona",
    "replaceBody": "Zgjidh cilën të zëvendësosh me {title}.",
    "replaceThis": "Zëvendëso këtë"
  },
  "filters": {
    "bathrooms": "Banjo",
    "countPlus": "{count}+",
    "priceRangeAria": "Diapazoni i çmimit",
    "priceShort": "Çmimi",
    "resetAllFilters": "Rivendos të gjithë filtrat"
  },
  "gallery": {
    "goToPhoto": "Shko te foto {n}",
    "nextPhoto": "Foto tjetër",
    "playVideo": "Luaj video-turin",
    "prevPhoto": "Foto e mëparshme",
    "tabFacade": "Fasada / vendndodhja e njësisë",
    "tabFloorplan": "Planimetria",
    "tabPhotos": "Foto",
    "tabVideo": "Video"
  },
  "listing": {
    "contactPublisher": "Kontakto botuesin",
    "inCompare": "Në krahasim"
  },
  "nav": {
    "compare": "Krahaso"
  },
  "project": {
    "constructionProgress": "Progresi i ndërtimit",
    "fullscreenUnavailable": "Ekrani i plotë nuk është i disponueshëm në këtë dritare",
    "northSign": "Rivendos në Veri",
    "progress": "Progresi",
    "screenshot": "Foto",
    "screenshotFailed": "Nuk u kap dot ekrani — provo përsëri",
    "screenshotSaved": "Fotoja u ruajt",
    "scrubTimeline": "Lëviz kohëgrafikun e ndërtimit"
  },
  "projectDetail": {
    "priceOnRequest": "Çmimi me kërkesë"
  },
  "publisher": {
    "call": "Telefono",
    "typeAgency": "Agjenci",
    "typeDeveloper": "Zhvillues",
    "typePrivateOwner": "Pronar Privat",
    "whatsapp": "WhatsApp"
  },
  "results": {
    "viewUnit": "Shiko Njësinë"
  },
  "unit": {
    "allBuildings": "Të gjitha ndërtesat",
    "anyBeds": "Çdo numër dhomash",
    "availableUnitsTitle": "Njësi të disponueshme",
    "bedPlus": "{count}+ dhoma",
    "buildingLabel": "Ndërtesa {name}",
    "closeUnitDiscovery": "Mbyll zbulimin e njësive",
    "collapseUnitDetail": "Shfaq më pak",
    "designThisApartment": "Dizajno këtë Apartament",
    "exitFloorView": "Dil nga Kati",
    "exitFloorViewTitle": "Mbyll prerjen e katit {n}",
    "floorLabel": "Kati {n}",
    "floorRailHeading": "Kati",
    "floorRailLabel": "Navigimi i kateve",
    "floorRailNoSection": "Ende nuk është vizatuar asnjë prerje për katin {n}",
    "floorRailNoSectionShort": "pa prerje",
    "floorRailUnits": "{count} njësi",
    "floorRailUnitsOne": "1 njësi",
    "noUnitsMatch": "Ende nuk ka njësi që përputhen me këto filtra.",
    "openRecord": "Hap regjistrimin e njësisë",
    "orientation": "Orientimi",
    "orientationE": "E — Lindje",
    "orientationN": "N — Veri",
    "orientationS": "S — Jug",
    "orientationW": "W — Perëndim",
    "requestSent": "Kërkesa u dërgua",
    "saveProject": "Ruaj projektin",
    "savedProject": "Ruajtur",
    "statusAvailable": "e disponueshme",
    "statusReserved": "e rezervuar",
    "statusSold": "e shitur",
    "typeCommercial": "Komerciale",
    "typeLabel": "Lloji",
    "typeParking": "Parkim",
    "typeResidential": "Banesë",
    "typeStorage": "Depo",
    "unitsMatch": "{matched} nga {total} njësi përputhen",
    "viewInFloor": "Shiko në Kat",
    "viewInFloorTitle": "Prit ndërtesën te kati {n}",
    "viewerBuilding": "Ndërtesa",
    "viewerFilterAll": "Të gjitha",
    "viewerFullscreen": "Ndrysho ekranin e plotë",
    "whatsappInterest": "Përshëndetje, më intereson njësia {code} në projektin {project}"
  },
  "compareFields": {
    "price": "Çmimi",
    "pricePerSqm": "Çmimi / m²",
    "area": "Sipërfaqja",
    "bedrooms": "Dhoma gjumi",
    "bathrooms": "Banjo",
    "floor": "Kati",
    "propertyType": "Lloji i pronës",
    "transaction": "Transaksioni",
    "parking": "Parkim",
    "balconyTerrace": "Ballkon / tarracë",
    "furnished": "I/e mobiluar",
    "neighborhood": "Zona",
    "publisher": "Botuesi",
    "availability": "Disponueshmëria",
    "yes": "Po",
    "no": "Jo",
    "available": "E disponueshme",
    "projectUnit": "Njësi projekti"
  }
};

const dictionaries: Record<Locale, ViewerDictionary> = { en, sq };

function lookup(dict: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in acc) return (acc as Record<string, unknown>)[key];
    return undefined;
  }, dict);
}

export function translateViewer(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  const raw = lookup(dictionaries[locale], key) ?? lookup(dictionaries.en, key);
  let text = typeof raw === "string" ? raw : key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}

/** The Rozaris `useT` contract: `t(key, vars)` plus the active locale. */
export function useT() {
  const locale = useViewerStore((s) => s.locale);
  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translateViewer(locale, key, vars),
    [locale],
  );
  return { t, locale };
}
