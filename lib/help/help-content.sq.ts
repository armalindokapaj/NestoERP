/**
 * Module Help in Albanian. Same keys, same list lengths and same order as
 * MODULE_HELP (lib/help/help-content.ts): only the words differ. Permissions
 * and pages stay with the English entry; `helpContent("sq")` joins them by
 * position. Loaded by the Help pages only, never by the module header.
 */
import type { ModuleHelpText } from "@/lib/help/help-content";
import type { ModuleKey } from "@/config/modules";

const STANDARD_PERMISSIONS =
  "Roli juaj përcakton cilat seksione shihni dhe cilat veprime ju ofrohen; kompania përcakton nëse moduli është i aktivizuar. Çdo faqe kontrollon sërish kur hapet, ndaj një lidhje që ndan dikush me ju hap vetëm atë që mund të shihni.";

export const MODULE_HELP_SQ: Record<ModuleKey, ModuleHelpText> = {
  tasks: {
    purpose:
      "Detyrat janë puna që dikush duhet ta kryejë, me një përgjegjës dhe një afat. Një detyrë mund të qëndrojë më vete ose t’i përkasë një projekti, dhe mund të lidhet me regjistrimin nga ku ka lindur.",
    terms: [
      { term: "Detyrë", meaning: "Një punë e vetme me titull, përgjegjës, prioritet dhe afat." },
      { term: "Përgjegjësi", meaning: "Personi përgjegjës për detyrën. Caktimi i dikujt e njofton atë." },
      { term: "Statusi", meaning: "Për t’u bërë, Në proces, Bllokuar, Përfunduar ose Arkivuar. Bllokuar do të thotë se puna nuk mund të vazhdojë derisa të ndodhë diçka tjetër." },
      { term: "Prioriteti", meaning: "I ulët, Mesatar, I lartë ose Kritik." },
      { term: "Me vonesë", meaning: "E hapur (jo e përfunduar) dhe me afatin e kaluar." },
      { term: "Detyrat e mia", meaning: "Detyrat që ju janë caktuar juve. Të gjitha detyrat tregon çdo detyrë që roli juaj mund të shohë." },
    ],
    actions: [
      { label: "Detyrë e re", description: "Hap formularin e detyrës. Nëse vini nga një projekt, projekti plotësohet për ju." },
      { label: "Cakto", description: "Zgjidhni ose ndryshoni kush është përgjegjës, nga faqja e detyrës." },
      { label: "Ndrysho statusin", description: "Kaloni një detyrë mes Për t’u bërë, Në proces dhe Bllokuar sipas ecurisë së punës." },
      { label: "Përfundo", description: "Shënon detyrën si Përfunduar; ajo kalon në seksionin e detyrave të përfunduara." },
      { label: "Arkivo", description: "E heq një detyrë nga listat e punës pa e fshirë. Rikthimi e kthen prapa." },
    ],
    permissions:
      "Disa role shohin çdo detyrë të kompanisë, të tjerat vetëm detyrat e projekteve të tyre ose ato që u janë caktuar. Krijimi, caktimi, përfundimi dhe arkivimi janë leje të ndara, ndaj mund të ndryshoni një detyrë që nuk mund ta arkivoni.",
  },
  approvals: {
    purpose:
      "Një vend i vetëm për çdo vendim që pret ju — fatura, shpenzime, kërkesa blerjeje, kontrata, regjistrime cilësie dhe sigurie e më shumë — nga cilido modul që vijnë.",
    terms: [
      { term: "Miratim", meaning: "Një kërkesë për vendim mbi një regjistrim, e hapur kur dikush e dorëzon." },
      { term: "Presin për mua", meaning: "Vendimet që janë tani për t’u marrë nga ju." },
      { term: "Kërkuar nga unë", meaning: "Regjistrimet që keni dorëzuar dhe ecuria e tyre." },
      { term: "Hapi", meaning: "Disa miratime kalojnë te disa miratues me radhë; Mirato hapin 1 e kalon te tjetri." },
      { term: "Kthim", meaning: "E kthen regjistrimin te autori për ndryshime. Kërkon një arsye." },
      { term: "Delegim", meaning: "I lejon dikujt të vendosë në vendin tuaj kur mungoni, për periudhën që caktoni." },
    ],
    actions: [
      { label: "Mirato", description: "Pranon regjistrimin në hapin tuaj. Mund të shtoni një shënim." },
      { label: "Refuzo", description: "Refuzon regjistrimin. Arsyeja është e detyrueshme dhe autori e sheh." },
      { label: "Kthe", description: "I kërkon autorit ndryshime. Arsyeja është e detyrueshme." },
      { label: "Delego", description: "Ia kalon vendimet tuaja një kolegu për një periudhë." },
    ],
    permissions:
      "Shihni vetëm miratimet ku jeni miratues ose që i keni dorëzuar vetë. Nëse Mirato, Refuzo ose Kthe ofrohet për një artikull varet nga leja e miratimit e vetë modulit burimor për atë lloj regjistrimi, dhe kontrollohet sërish kur vendosni.",
  },
  finance: {
    purpose:
      "Paratë e kompanisë: faturat për klientët, pagesat, shpenzimet, buxhetet dhe angazhimet, me miratime para se të dalë diçka nga kompania.",
    terms: [
      { term: "Faturë", meaning: "Një faturim për një klient. Draft → Në pritje të miratimit → Miratuar → Dërguar; mund të jetë edhe Refuzuar, Anuluar ose Arkivuar." },
      { term: "Shpenzim", meaning: "Një kosto që kompania ka pasur, opsionalisht në ngarkim të një projekti. Draft → Në pritje të miratimit → Miratuar, ose Refuzuar." },
      { term: "Dërgo për miratim", meaning: "Ia dërgon një fature ose shpenzimi në draft miratuesve të tij. Ndërsa pret, nuk mund të ndryshohet lirisht." },
      { term: "Pagesë", meaning: "Para të arkëtuara kundrejt një fature ose të paguara jashtë." },
      { term: "Buxhet", meaning: "Shuma e planifikuar për një projekt ose kategori kostoje." },
      { term: "Angazhim", meaning: "Para të premtuara tashmë — për shembull me një porosi blerjeje — por ende të pashpenzuara." },
    ],
    actions: [
      { label: "Faturë e re", description: "Hap formularin e faturës. Nëse vini nga një projekt ose klient, ai kontekst plotësohet." },
      { label: "Shpenzim i ri", description: "Regjistron një kosto, bashkë me faturën e blerjes nëse e keni." },
      { label: "Dërgo për miratim", description: "Ia dërgon një fature në draft miratuesve të saj." },
      { label: "Dërgo për miratim", description: "Ia dërgon një shpenzim në draft miratuesve të tij." },
      { label: "Eksporto", description: "Shkarkon listën që po shihni, me filtrat e saj." },
    ],
    permissions:
      "Seksionet e Financës shfaqen një nga një: kush ka vetëm qasje në buxhetin e projektit sheh Përmbledhjen dhe asgjë tjetër. Krijimi, dërgimi, miratimi dhe arkivimi i faturave dhe shpenzimeve janë leje të ndara.",
  },
  projects: {
    purpose:
      "Projektet mbajnë gjithçka për një punë: ekipin, detyrat, dokumentet, ditarët e kantierit, pikat kyçe, ndërtesat dhe njësitë, si dhe kostot.",
    terms: [
      { term: "Projekt", meaning: "Një zhvillim ose punë që kompania e drejton. Statusi i tij është Në pritje, Aktiv ose Përfunduar; projektet e arkivuara kalojnë te Arkivuar." },
      { term: "Menaxheri i projektit", meaning: "Personi përgjegjës për projektin; anëtarët e projektit punojnë në të." },
      { term: "Pikë kyçe", meaning: "Një datë e planifikuar në planin e projektit, e ndjekur për vonesa." },
      { term: "Njësi", meaning: "Një hapësirë e shitshme në një ndërtesë — apartament, dyqan ose vend parkimi." },
      { term: "Lloji i projektit", meaning: "Klasifikimi i vetë kompanisë për projektet." },
    ],
    actions: [
      { label: "Projekt i ri", description: "Hap formularin e projektit. Projekti fillon Në pritje." },
      { label: "Shto anëtar", description: "Shton një koleg në ekipin e projektit nga skeda Ekipi e tij." },
      { label: "Arkivo", description: "E heq një projekt të përfunduar nga lista e punës. Rikthimi e kthen prapa." },
    ],
    permissions:
      "Disa role shohin çdo projekt të kompanisë, të tjerat vetëm projektet ku janë anëtarë. Skedat e një projekti ndjekin lejet tuaja për detyrat, dokumentet, financat dhe të tjerat.",
  },
  dailyLogs: {
    purpose:
      "Regjistri ditor i kantierit për çdo projekt: kush ishte në kantier, çfarë u bë, dërgesat, vonesat, moti dhe fotot — shkruhet gjatë ditës dhe shqyrtohet më pas.",
    terms: [
      { term: "Ditar kantieri", meaning: "Regjistri i një projekti për një ditë." },
      { term: "Statusi", meaning: "Draft → Dorëzuar → Shqyrtuar → Kyçur. Një shqyrtues mund ta kthejë si Kërkohet korrigjim; një ditar mund të jetë Anuluar." },
      { term: "Për shqyrtim", meaning: "Ditarët e dorëzuar që presin një shqyrtues." },
      { term: "Kyçur", meaning: "Dita është mbyllur; ndryshimi i saj kërkon lejen për të korrigjuar ditarët e kyçur dhe lë gjurmë." },
    ],
    actions: [
      { label: "Fillo ditarin e sotëm", description: "Fillon ditarin e sotëm nga skeda Ditarët e kantierit e projektit; Regjistro një ditë të mëparshme mbulon një ditë të humbur brenda afatit të lejuar. + Krijo kërkon fillimisht projektin." },
      { label: "Dorëzo ditarin", description: "E dërgon ditarin e ditës për shqyrtim." },
      { label: "Shëno si të shqyrtuar", description: "Pranon një ditar të dorëzuar." },
      { label: "Kyç", description: "E mbyll ditën që të mos ndryshojë më." },
    ],
    permissions:
      "Shihni ditarët e projekteve që mund t’i hapni. Shkrimi, dorëzimi, shqyrtimi dhe kyçja janë leje të ndara, ndaj ekipi i kantierit shkruan dhe menaxheri i projektit shqyrton.",
  },

  // ─── The short standard section ─────────────────────────────────────────────
  dashboard: {
    purpose: "Pika juaj e nisjes: shifrat, listat dhe shkurtoret që kanë rëndësi për rolin tuaj, në hapësirën e punës ku ndodheni.",
    terms: [
      { term: "Hapësira e punës", meaning: "Grupi (çdo kompani ku mund të hyni) ose një Kompani. Paneli tregon hapësirën e punës të emërtuar nën titullin e tij." },
      { term: "Panel", meaning: "Një kuti me shifra ose regjistrime të drejtpërdrejta; secili lidhet me listën e filtruar prapa tij." },
    ],
    actions: [],
    permissions: "Çdo shifër dhe listë filtrohet sipas lejeve tuaja. Një panel që i përket një moduli të çaktivizuar, ose që nuk mund ta shihni, nuk shfaqet.",
  },
  calendar: {
    purpose: "Afatet, ngjarjet dhe orarët nga çdo modul që mund të hapni, në një kalendar të vetëm.",
    terms: [{ term: "Ngjarje", meaning: "Një hyrje e vetë kalendarit; hyrjet e tjera vijnë nga detyrat, takimet, pikat kyçe dhe regjistrime të tjera." }],
    actions: [{ label: "Ngjarje e re", description: "Shton një ngjarje në kalendar." }],
    permissions: STANDARD_PERMISSIONS,
  },
  announcements: {
    purpose: "Njoftime të kompanisë, departamentit dhe projektit, disa që kërkojnë konfirmimin tuaj. I lexoni te zilja e Aktivitetit.",
    terms: [{ term: "Konfirmo", meaning: "Vërteton se e keni lexuar një njoftim që e kërkon këtë." }],
    actions: [{ label: "Njoftim i ri", description: "Shkruan një njoftim për një audiencë që zgjidhni." }],
    permissions: STANDARD_PERMISSIONS,
  },
  meetings: {
    purpose: "Rendet e ditës, procesverbalet, vendimet dhe veprimet që pasojnë një takim.",
    terms: [{ term: "Veprim", meaning: "Një punë vijuese e rënë dakord në një takim, me një përgjegjës dhe një afat." }],
    actions: [{ label: "Takim i ri", description: "Planifikon një takim dhe rendin e tij të ditës." }],
    permissions: STANDARD_PERMISSIONS,
  },
  timesheets: {
    purpose: "Si shpenzohet koha e punës nëpër projekte, detyra dhe punë të brendshme, javë pas jave.",
    terms: [{ term: "Fletë orësh", meaning: "Java e një personi me regjistrime kohe, e dorëzuar për miratim." }],
    actions: [],
    permissions: "Secili mban fletën e vet të orëve; pamjet e ekipit dhe të projektit kërkojnë leje të veta.",
  },
  workforce: {
    purpose: "Gjithë ata që kompania punëson në projektet e saj, me ose pa hyrje në NESTO: skuadra, kantiere, caktime dhe prezencë.",
    terms: [
      { term: "Punëtor", meaning: "Një person i punësuar në kantier. Jo gjithkush këtu ka llogari në NESTO." },
      { term: "Skuadër", meaning: "Një ekip punëtorësh të caktuar së bashku." },
    ],
    actions: [],
    permissions: STANDARD_PERMISSIONS,
  },
  contractors: {
    purpose: "Organizatat që ndërtojnë me ju: caktimet e tyre, paketat e punës, dokumentet e përputhshmërisë dhe kontratat.",
    terms: [
      { term: "Kontraktor", meaning: "Një kompani e jashtme që punon në projektet tuaja." },
      { term: "Paketë pune", meaning: "Një shtrirje e përcaktuar pune që i jepet një kontraktori." },
    ],
    actions: [],
    permissions: STANDARD_PERMISSIONS,
  },
  engineering: {
    purpose: "Regjistri teknik i çdo projekti: vizatimet dhe revizionet, RFI, dorëzimet teknike dhe transmetimet.",
    terms: [
      { term: "RFI", meaning: "Kërkesë për informacion — një pyetje teknike që kërkon përgjigje zyrtare." },
      { term: "Dorëzim teknik", meaning: "Materiale ose vizatime të dërguara për rishikim dhe miratim." },
      { term: "Transmetim", meaning: "Një regjistrim i dokumenteve të dërguara zyrtarisht te dikush." },
    ],
    actions: [],
    permissions: STANDARD_PERMISSIONS,
  },
  clients: {
    purpose: "Kompanitë dhe personat me të cilët punon kompania juaj, si dhe projektet, kontaktet dhe dokumentet e tyre.",
    terms: [{ term: "Klient", meaning: "Një kompani ose person për të cilin bëni punë ose të cilit i shisni." }],
    actions: [{ label: "Klient i ri", description: "Shton një klient." }],
    permissions: STANDARD_PERMISSIONS,
  },
  documents: {
    purpose: "Dokumentet e kompanisë, projekteve dhe klientëve në një vend, me versione dhe kontroll qasjeje.",
    terms: [{ term: "Dokument", meaning: "Një skedar me detajet e tij, i lidhur me një projekt, klient ose regjistrim tjetër, ose me kompaninë." }],
    actions: [{ label: "Shto dokument", description: "Ngarkon një dokument dhe e arkivon në vendin e duhur." }],
    permissions: STANDARD_PERMISSIONS,
  },
  hr: {
    purpose: "Operacionet me njerëzit: dosjet e punësimit, lejet, prezenca, rekrutimi dhe dokumentet e burimeve njerëzore.",
    terms: [
      { term: "Punonjës", meaning: "Punësimi i një personi në kompani, i mbajtur nga burimet njerëzore." },
      { term: "Kërkesë për leje", meaning: "Një kërkesë për kohë pushimi, e miratuar nga menaxheri i personit ose nga burimet njerëzore." },
    ],
    actions: [{ label: "Kërko leje", description: "Kërkon kohë pushimi." }],
    permissions: "Burimet njerëzore shohin gjithë modulin. Me vetëshërbim të vetëm shihni punësimin, lejet, prezencën dhe dokumentet tuaja, të shënuara si tuajat.",
  },
  sales: {
    purpose: "Kontaktet potenciale, mundësitë, portofoli i shitjeve dhe ofertat — nga kontakti i parë deri te puna e fituar.",
    terms: [
      { term: "Kontakt potencial", meaning: "Një klient i mundshëm që ende nuk është kualifikuar." },
      { term: "Mundësi", meaning: "Një marrëveshje e kualifikuar me vlerë dhe fazë në portofolin e shitjeve." },
      { term: "Ofertë", meaning: "Oferta që i dërgohet klientit për një mundësi." },
    ],
    actions: [
      { label: "Kontakt potencial i ri", description: "Regjistron një kontakt të ri potencial." },
      { label: "Mundësi e re", description: "Hap një mundësi." },
    ],
    permissions: STANDARD_PERMISSIONS,
  },
  contracts: {
    purpose: "Ligjore: kontratat, miratimet e tyre, shtojcat dhe detyrimet, si dhe kërkesat për kontrata njësish nga Shitjet.",
    terms: [
      { term: "Kontratë", meaning: "Një marrëveshje ligjore me një klient, furnitor ose kontraktor." },
      { term: "Shtojcë kontrate", meaning: "Një ndryshim i nënshkruar i një kontrate ekzistuese." },
    ],
    actions: [{ label: "Kontratë e re", description: "Harton një kontratë." }],
    permissions: STANDARD_PERMISSIONS,
  },
  procurement: {
    purpose: "Blerjet për kompaninë dhe projektet e saj: kërkesat e blerjes, kërkesat për ofertë te furnitorët, porositë e blerjes dhe furnitorët.",
    terms: [
      { term: "Kërkesë blerjeje", meaning: "Një kërkesë e brendshme për të blerë diçka. Miratohet para se të porositet ndonjë gjë." },
      { term: "Kërkesë për ofertë (RFQ)", meaning: "Një kërkesë për ofertë e dërguar furnitorëve." },
      { term: "Porosi blerjeje", meaning: "Porosia e bërë te një furnitor, e hapur nga një kërkesë e miratuar ose një kërkesë për ofertë — nuk është e njëjta gjë me një kërkesë blerjeje." },
    ],
    actions: [{ label: "Kërkesë e re blerjeje", description: "Kërkon që të blihet diçka." }],
    permissions: STANDARD_PERMISSIONS,
  },
  inventory: {
    purpose: "Materialet, nivelet e stokut sipas magazinës dhe çdo lëvizje hyrëse e dalëse.",
    terms: [
      { term: "Pranim", meaning: "Stok që hyn në një magazinë." },
      { term: "Dalje", meaning: "Stok që del nga një magazinë për përdorim." },
      { term: "Lëvizje", meaning: "Rreshti i regjistrit që shkruan çdo pranim, dalje, kthim, transferim dhe rregullim." },
    ],
    actions: [{ label: "Pranim i ri", description: "Regjistron stokun që po arrin." }],
    permissions: STANDARD_PERMISSIONS,
  },
  qaqc: {
    purpose: "Kontrolli i cilësisë: inspektimet, të metat, raportet e mospërputhjes dhe veprimet korrigjuese.",
    terms: [
      { term: "Inspektim", meaning: "Një kontroll cilësie sipas një shablloni." },
      { term: "NCR", meaning: "Raport mospërputhjeje — punë që nuk i përmbahet specifikimit." },
    ],
    actions: [
      { label: "Inspektim i ri", description: "Fillon një inspektim cilësie." },
      { label: "NCR e re", description: "Ngre një mospërputhje." },
    ],
    permissions: STANDARD_PERMISSIONS,
  },
  hse: {
    purpose: "Shëndeti, siguria dhe mjedisi: rreziqet, incidentet, inspektimet, lejet dhe veprimet që pasojnë.",
    terms: [
      { term: "Rrezik", meaning: "Diçka në kantier që mund të shkaktojë dëm, e raportuar para se ta bëjë." },
      { term: "Incident", meaning: "Diçka që ka ndodhur — një lëndim, dëmtim ose rast i shmangur për pak." },
    ],
    actions: [
      { label: "Raporto një rrezik", description: "Raporton një rrezik, nga kudo që ndodheni." },
      { label: "Raporto një incident", description: "Regjistron një incident." },
    ],
    permissions: STANDARD_PERMISSIONS,
  },
  people: {
    purpose: "Gjithë njerëzit e grupit tuaj ashtu siç i njohin kolegët: kush janë, ku punojnë dhe si t’i kontaktoni.",
    terms: [{ term: "Person", meaning: "Një qenie njerëzore në të gjithë grupin; punësimet e tij mbahen nga burimet njerëzore." }],
    actions: [],
    permissions: "Çdo rol i brendshëm mund të hapë Njerëzit. Asgjë që burimet njerëzore e mbajnë private nuk shfaqet këtu.",
  },
  team: {
    purpose: "Gjithë ata që kanë hyrje në këtë hapësirë pune të kompanisë, departamentet dhe ftesat e tyre.",
    terms: [{ term: "Anëtar", meaning: "Një person me qasje në këtë kompani, me një rol." }],
    actions: [{ label: "Fto anëtar", description: "I dërgon ftesë dikujt dhe i jep një rol." }],
    permissions: STANDARD_PERMISSIONS,
  },
  organization: {
    purpose: "Grupi juaj mëmë: kompanitë e tij, departamentet e grupit, njerëzit dhe kërkesat për llogari.",
    terms: [
      { term: "Grup", meaning: "Organizata mëmë mbi kompanitë." },
      { term: "Kompani", meaning: "Një kompani ligjore e grupit, me hapësirën e vet të punës dhe module." },
    ],
    actions: [],
    permissions: STANDARD_PERMISSIONS,
  },
  company: {
    purpose: "Identiteti i kësaj kompanie, detajet e saj dhe modulet e aktivizuara për të.",
    terms: [{ term: "Modul", meaning: "Një pjesë e NESTO që kompania mund ta aktivizojë ose çaktivizojë." }],
    actions: [],
    permissions: "Çdokush mund të lexojë detajet e kompanisë; ndryshimi i tyre dhe i moduleve kërkon menaxhimin e kompanisë.",
  },
  settings: {
    purpose: "Profili dhe preferencat tuaja, dhe — për administratorët — konfigurimi i kompanisë.",
    terms: [],
    actions: [],
    permissions: "Profili, pamja dhe njoftimet tuaja janë gjithmonë tuajat; cilësimet e kompanisë kërkojnë menaxhimin e cilësimeve.",
  },
  support: {
    purpose: "Kërkesat e brendshme për mbështetje dhe ky ndihmës.",
    terms: [],
    actions: [],
    permissions: STANDARD_PERMISSIONS,
  },
};
