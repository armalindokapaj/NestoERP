import type { SiteCopy } from "./en";

/**
 * The public site in Albanian (Shqip).
 *
 * Typed against the English source, so a missing or misspelt key fails the type
 * check; tests/unit/i18n/site-copy.test.ts checks what types cannot — that every
 * list holds as many entries as the English one and no string is left empty.
 *
 * Product and industry names stay as they are said in Albania too — NESTO,
 * QA/QC, HSE, NCR, ERP — as in the interface dictionary. Plan names are
 * translated, and every mention of a plan uses the translated name.
 */
export const siteSq: SiteCopy = {
  category: "Sistemi operativ i ndërtimit",
  summary:
    "NESTO është sistemi operativ i ndërtimit — projektet, prokurimi, cilësia, siguria, njerëzit dhe financat në një hapësirë të vetme pune.",
  replyTime: "Përgjigjemi brenda një dite pune.",

  meta: {
    contact: {
      title: "Kontakt",
      description:
        "Kërkoni akses, rezervoni një prezantim ose vendosni një rishikim sigurie para ekipit tuaj të IT-së. Përgjigjet një person.",
    },
    faq: {
      title: "Pyetje",
      description:
        "Çfarë është NESTO, cilat module përfshihen, si zbatohet aksesi, sa kushton dhe çfarë është gati — me përgjigje të drejtpërdrejta.",
    },
    platform: {
      title: "Platforma",
      description:
        "Shtatëmbëdhjetë module, tetëmbëdhjetë hapësira pune sipas rolit dhe një regjistër i vetëm projekti — i gjithë cikli i ndërtimit në një sistem.",
    },
    pricing: {
      title: "Çmimet",
      description:
        "Një çmim për kompani, me të shtatëmbëdhjetë modulet të përfshira në çdo plan. Pa pagesa shtesë për modul dhe pa surpriza për përdorues.",
    },
    security: {
      title: "Siguria",
      description:
        "Si kontrollohet aksesi në NESTO: lejet rrjedhin nga roli, zbatohen në hyrje dhe sërish brenda faqes.",
    },
  },

  header: {
    home: "Sistemi operativ i ndërtimit — faqja kryesore",
    siteNavigation: "Faqja",
    drawerTitle: "Navigimi i faqes",
    openMenu: "Hap menunë",
    closeMenu: "Mbyll menunë",
    signIn: "Hyr",
    requestAccess: "Kërko akses",
    language: "Gjuha",
  },

  nav: {
    platform: "Platforma",
    pricing: "Çmimet",
    security: "Siguria",
    about: "Rreth nesh",
    contact: "Kontakt",
    faq: "Pyetje",
  },

  footer: {
    columns: {
      platform: "Platforma",
      company: "Kompania",
      access: "Aksesi",
    },
    links: {
      overview: "Përmbledhje",
      modules: "Modulet",
      roles: "Rolet",
      lifecycle: "Cikli i projektit",
      pricing: "Çmimet",
      about: "Rreth nesh",
      security: "Siguria",
      questions: "Pyetje",
      contact: "Kontakt",
      signIn: "Hyr",
      requestAccess: "Kërko akses",
      privacy: "Privatësia",
      terms: "Kushtet",
    },
  },

  /* ---------------------------------------------------------------- *
   * Landing page
   * ---------------------------------------------------------------- */

  home: {
    hero: {
      headline: ["Drejtoni gjithë ndërtimin", "nga një sistem i vetëm."],
      lead: "Nga tenderi te dorëzimi, nga kantieri te bordi drejtues. NESTO mban çdo projekt, kontratë, porosi blerjeje, inspektim, faturë dhe person mbi të cilët funksionon një kompani ndërtimi — në një hapësirë të vetme pune, nën një grup të vetëm lejesh.",
      primary: "Kërko akses",
      secondary: "Hyr",
      note: "Një hapësirë pune për kompani. Llogaritë krijohen nga administratori juaj.",
    },
    problem: {
      eyebrow: "Problemi",
      title: "Shumica e kompanive të ndërtimit punojnë me njëmbëdhjetë sisteme që nuk flasin kurrë me njëri-tjetrin.",
      lead: "Asnjëri prej tyre nuk është i gabuar më vete. Së bashku janë një punë rakordimi që përsëritet çdo muaj, pa fund, dhe në heshtje kushton më shumë se vetë softueri.",
    },
    platform: {
      eyebrow: "Platforma",
      title: "Shtatëmbëdhjetë module. Një hapësirë pune.",
      lead: "Çdo departament në të njëjtin sistem, mbi të njëjtin regjistër projekti — me prokurimin, cilësinë dhe sigurinë si punë parësore, jo si shtesa.",
      cta: "Eksploroni platformën",
    },
    roles: { cta: "Shihni të 18 rolet" },
    build: {
      eyebrow: "Nga fillimi në fund",
      title: "Nga tenderi që e fiton, te llogaria që e mbyll.",
      lead: "Një projekt nuk ndalet te dorëzimi dhe nuk fillon në kantier. NESTO e ndjek nga fillimi në fund, dhe çdo fazë shkruan në të njëjtin regjistër.",
    },
    principles: {
      eyebrow: "Pse ndihet ndryshe",
      title: "Cilësia e lartë nuk është zbukurim. Është ajo që është lënë jashtë.",
      lead: "Një paletë e kufizuar ngjyrash, një shkallë tipografike, një librari komponentësh dhe asnjë zbukurim që nuk mbart informacion.",
    },
    access: { eyebrow: "Aksesi", cta: "Si funksionon aksesi" },
    questions: {
      eyebrow: "Pyetje",
      title: "Gjashtë gjërat që pyet kushdo në fillim.",
      cta: "Të gjitha pyetjet",
    },
  },

  stats: {
    modules: { label: "Module", note: "Të gjitha të përfshira, në çdo plan." },
    roles: { label: "Role", note: "Secili me hapësirën e vet të punës dhe panelin e vet." },
    sourceOfTruth: { label: "Burim i së vërtetës", note: "Një bazë të dhënash pas çdo departamenti." },
    spreadsheets: {
      label: "Fletë llogaritëse ndërmjet",
      note: "Asgjë nuk rishkruhet me dorë nga një ekip te tjetri.",
    },
  },

  contrasts: [
    {
      before: "Një fletë llogaritëse për tenderin, një grup bisede për kantierin dhe dosja e kontabilistit.",
      after: "Një regjistër projekti nga i cili lexon dhe në të cilin shkruan çdo departament.",
    },
    {
      before: "Raportim mujor i mbledhur me dorë nga katër eksporte.",
      after: "Një panel që është vetë raporti, për rolin që e lexon.",
    },
    {
      before: "Aksesi vendoset nga kush ndodh ta ketë skedarin.",
      after: "Aksesi vendoset nga roli dhe refuzohet në çdo kërkesë të paautorizuar.",
    },
    {
      before: "Një mjet i përgjithshëm biznesi, i përkulur në formën e ndërtimit.",
      after: "Prokurimi, QA/QC dhe HSE si module parësore, jo si shtesa.",
    },
  ],

  moduleCopy: {
    dashboard: "Ekrani që çdo rol hap i pari — shifrat e veta, jo ato të të gjithë të tjerëve.",
    calendar: "Afatet, inspektimet, dorëzimet dhe ngjarjet e kompanisë në një orar të vetëm sipas lejeve.",
    timesheets: "Fletë orësh javore sipas projekteve dhe detyrave — të regjistruara në minuta, të miratuara nga personi i duhur, pa mbikëqyrje.",
    dailyLogs: "Një ditar kantieri për çdo projekt çdo ditë — fuqia punëtore, punimet, dorëzimet, vonesat dhe fotot, të shqyrtuara dhe të kyçura si regjistër.",
    contractors: "Çdo kontraktor që angazhoni — caktimet në projekte, paketat e punës, sigurimet dhe garancitë, dhe kontratat pas tyre.",
    engineering: "Regjistra vizatimesh dhe dokumentesh me rishikime të kontrolluara, RFI, dorëzime teknike, metodologji punimesh dhe transmetime.",
    announcements: "Njoftime për kompaninë, departamentet dhe projektet që njerëzit i konfirmojnë kur ka rëndësi — pa rrjedhë sociale, pa reagime.",
    approvals: "Çdo vendim që pret për ju — porosi blerjeje, fatura, leje, kontrata, dokumente — shqyrtuar dhe vendosur në një vend.",
    projects: "Çdo projekt si një regjistër i vetëm: grafiku, ekipi, buxheti, vizatimet dhe statusi.",
    tasks: "Puna e përditshme e caktuar në kantier dhe në zyrë, gjithmonë e lidhur me një projekt.",
    meetings: "Rendet e ditës, procesverbalet, vendimet dhe veprimet që pasojnë — secili veprim mund të bëhet detyrë.",
    clients: "Klientët, kontaktet dhe historiku i çdo pune që keni realizuar për ta.",
    documents: "Vizatimet, metodologjitë e punimeve, certifikatat dhe kontratat në një vend.",
    finance: "Buxhetet, faturat, pagesat dhe kostoja kundrejt vlerës — për projekt dhe për gjithë kompaninë.",
    hr: "Skuadrat dhe stafi, prezenca, lejet, dosjet dhe rekrutimi.",
    sales: "Portofoli, mundësitë dhe ofertat — tenderi para se të bëhet kontratë.",
    contracts: "Kontratat, miratimet dhe njoftimet, me gjurmën e dokumenteve të paprekur.",
    procurement: "Kërkesat, kërkesat për ofertë, tenderat, furnitorët, porositë e blerjes dhe dorëzimet.",
    inventory: "Materialet, nivelet e stokut dhe lëvizjet ndërmjet magazinave dhe kantiereve.",
    qaqc: "Inspektimet, mospërputhjet, testet dhe listat e defekteve, të mbyllura në regjistër.",
    hse: "Incidentet, lejet e punës, inspektimet dhe veprimet korrigjuese.",
    team: "Të gjithë në kompani, me departamentin dhe rolin nën të cilin punojnë.",
    company: "Identiteti i kompanisë dhe të dhënat me të cilat lëshohet çdo dokument.",
    settings: "Rolet, përdoruesit, aktivizimi i moduleve dhe pamja, në duart e administratorit.",
    support: "Kërkesat e brendshme dhe baza e njohurive që shkruan vetë ekipi juaj.",
  },

  moduleZones: {
    primary: { title: "Përmbledhje", lead: "Ku fillon çdo rol." },
    work: { title: "Puna", lead: "Përditshmëria e realizimit të një projekti." },
    department: {
      title: "Departamentet",
      lead: "Tetë funksionet mbi të cilat funksionon një kompani ndërtimi.",
    },
    company: { title: "Kompania", lead: "Organizata pas projekteve." },
  },

  configLabels: {
    sections: {
      Overview: "Përmbledhje",
      Archived: "Të arkivuara",
      "Project types": "Llojet e projekteve",
      "Unit types": "Llojet e njësive",
      "My Tasks": "Detyrat e mia",
      Upcoming: "Në vijim",
      "My Meetings": "Takimet e mia",
      Past: "Të kaluara",
      "All Tasks": "Të gjitha detyrat",
      Overdue: "Me vonesë",
      Completed: "Të përfunduara",
      "All Clients": "Të gjithë klientët",
      Active: "Aktive",
      "All Documents": "Të gjitha dokumentet",
      Recent: "Të fundit",
      Invoices: "Faturat",
      Payments: "Pagesat",
      Expenses: "Shpenzimet",
      Budgets: "Buxhetet",
      Commitments: "Angazhimet",
      Approvals: "Miratimet",
      Reports: "Raportet",
      Employees: "Punonjësit",
      Leave: "Lejet",
      Attendance: "Prezenca",
      Onboarding: "Pranimi në punë",
      Offboarding: "Largimi nga puna",
      Documents: "Dokumentet",
      Leads: "Kontaktet e mundshme",
      Opportunities: "Mundësitë",
      Pipeline: "Portofoli",
      Proposals: "Ofertat",
      Tasks: "Detyrat",
      "All contracts": "Të gjitha kontratat",
      Drafts: "Draftet",
      Review: "Rishikimi",
      Expiring: "Në skadim",
      "Unit requests": "Kërkesat për njësi",
      Requests: "Kërkesat",
      Enquiries: "Kërkesat për ofertë",
      Orders: "Porositë",
      Suppliers: "Furnitorët",
      Items: "Artikujt",
      Warehouses: "Magazinat",
      Receipts: "Pranimet",
      Issues: "Daljet",
      Returns: "Kthimet",
      Transfers: "Transferimet",
      Adjustments: "Rregullimet",
      Reservations: "Rezervimet",
      Movements: "Lëvizjet",
      "Low stock": "Stok i ulët",
      Inspections: "Inspektimet",
      Templates: "Shabllonet",
      Materials: "Materialet",
      Work: "Punimet",
      Defects: "Defektet",
      NCRs: "NCR-të",
      "Corrective actions": "Veprimet korrigjuese",
      Reinspections: "Riinspektimet",
      Hazards: "Rreziqet",
      Incidents: "Incidentet",
      "Risk assessments": "Vlerësimet e rrezikut",
      Actions: "Veprimet",
      "Toolbox talks": "Takimet e sigurisë",
      Permits: "Lejet e punës",
      PPE: "PPE",
      Environment: "Mjedisi",
      "Stop work": "Ndalimi i punës",
      People: "Personat",
      Departments: "Departamentet",
      Invitations: "Ftesat",
      Inactive: "Joaktivë",
      "Company Details": "Të dhënat e kompanisë",
      Modules: "Modulet",
      Help: "Ndihmë",
      "My Timesheet": "Fleta ime e orëve",
      Team: "Ekipi",
      Projects: "Projektet",
      Settings: "Cilësimet",
      "All Logs": "Të gjithë ditarët",
      Milestones: "Pikat kyçe",
      "To Review": "Për shqyrtim",
      Contractors: "Kontraktorët",
      "Work Packages": "Paketat e punës",
      Compliance: "Pajtueshmëria",
      "My Work": "Puna ime",
      RFIs: "RFI-të",
      Submittals: "Dorëzimet teknike",
      Drawings: "Vizatimet",
      Transmittals: "Transmetimet",
    },
    departments: {
      Executive: "Drejtoria",
      Administration: "Administrata",
      IT: "IT",
      "Human Resources": "Burimet njerëzore",
      Projects: "Projektet",
      Design: "Projektimi",
      Engineering: "Inxhinieria",
      Finance: "Financa",
      Legal: "Çështjet ligjore",
      Sales: "Shitjet",
      Procurement: "Prokurimi",
      Operations: "Operacionet",
      Quality: "Cilësia",
      "Health & Safety": "Shëndeti dhe siguria",
      General: "Të përgjithshme",
    },
  },

  lifecycle: {
    tender: {
      title: "Tenderi",
      copy: "Portofoli, historiku i klientit dhe oferta që bëhet kontratë.",
    },
    award: {
      title: "Kontraktimi",
      copy: "Kontrata, buxheti dhe kushtet e pagesës regjistrohen një herë, pastaj përdoren kudo.",
    },
    mobilise: {
      title: "Mobilizimi",
      copy: "Grafiku, ekipi, furnitorët dhe porositë me afat të gjatë furnizimi, para se të nisë gërmimi.",
    },
    build: {
      title: "Ndërtimi",
      copy: "Puna e përditshme, materialet dhe vizatimet, të ndjekura kundrejt grafikut.",
    },
    assure: {
      title: "Kontrolli",
      copy: "Inspektimet, NCR-të, lejet e punës dhe incidentet — prova, jo kujtime.",
    },
    handOver: {
      title: "Dorëzimi",
      copy: "Llogaria përfundimtare, dokumentacioni i zbatimit dhe çfarë mëson prej tyre tenderi i ardhshëm.",
    },
  },

  pillars: [
    {
      title: "I shpejtë, qëllimisht",
      copy: "Faqet gjenerohen në server dhe dërgojnë pothuajse aspak JavaScript. Kjo faqe nuk ngarkon asnjë imazh — çdo vijë, grafik dhe kornizë që shihni vizatohet nga të njëjtat vlera dizajni që përdor produkti.",
      points: ["Gjeneruar në server", "Pa ngarkesë imazhesh", "Navigim i menjëhershëm"],
    },
    {
      title: "Një sistem, që duket",
      copy: "Shtatëmbëdhjetë module, një sistem dizajni. Një skedar i vetëm mban çdo ngjyrë, rreze, hije dhe kohëzgjatje, kështu që asnjë ekran nuk shpik të vetat. Mësoni një modul dhe i keni mësuar të gjitha.",
      points: ["Një grup vlerash dizajni", "Një librari komponentësh", "Një standard strukture"],
    },
    {
      title: "Kontroll që nga ndërtimi",
      copy: "Lejet rrjedhin nga roli, nuk shkruhen brenda ekraneve. Një modul i fshehur nga shiriti anësor refuzohet edhe nga ruteri — të dyja janë i njëjti konfigurim, ndaj nuk mund të ndahen nga njëri-tjetri.",
      points: ["Akses nga roli", "Refuzuar në hyrje", "Refuzuar sërish në faqe"],
    },
  ],

  /* ---------------------------------------------------------------- *
   * Roles
   * ---------------------------------------------------------------- */

  rolesSection: {
    eyebrow: "Ndërtuar rreth rolit",
    title: "Tetëmbëdhjetë persona hapin NESTO dhe shohin tetëmbëdhjetë kompani të ndryshme.",
    lead: "Një inxhinier kantieri nuk duhet të kalojë përmes listëpagesave për të arritur te një inspektim. Në NESTO, roli vendos navigimin, panelin, veprimet e shpejta dhe atë që do të përgjigjet serveri — të gjitha nga një konfigurim i vetëm.",
    readOnly: "Vetëm lexim",
  },

  /* ---------------------------------------------------------------- *
   * Product preview
   * ---------------------------------------------------------------- */

  preview: {
    description:
      "Paneli i NESTO: navigimi sipas rolit në të majtë, katër shifra kryesore në krye, një tabelë e projekteve aktive me progresin kundrejt grafikut dhe ndarja e punës sipas fazës.",
    search: "Kërkoni projekte, persona, dokumente",
    role: "CEO / Drejtor",
    greeting: "Mirëmëngjes, Sofia",
    subtitle: "Performanca e kompanisë në 12 kantiere.",
    date: "E hënë · 14 shtator 2026",
    kpis: {
      activeProjects: { label: "Projekte aktive", hint: "+2 këtë tremujor" },
      contractValue: { label: "Vlera e kontraktuar", hint: "+8,4% kundrejt planit" },
      openNcrs: { label: "NCR të hapura", hint: "−4 nga muaji i kaluar" },
      daysWithoutIncident: { label: "Ditë pa incident", hint: "Në çdo kantier aktiv" },
    },
    trend: "{label} — trendi",
    activeProjects: "Projekte aktive",
    progress: "Progresi",
    projectProgress: "{name} — progresi",
    statuses: {
      planning: "Planifikim",
      "in-progress": "Në proces",
      handover: "Në dorëzim",
      archived: "Arkivuar",
    },
    workByStage: "Puna sipas fazës",
    stages: { build: "Ndërtimi", mobilise: "Mobilizimi", tender: "Tenderi", handover: "Dorëzimi" },
    projectsByStage: "Projektet sipas fazës",
    projects: "Projekte",
  },

  /* ---------------------------------------------------------------- *
   * Platform
   * ---------------------------------------------------------------- */

  platform: {
    eyebrow: "Platforma",
    title: "Gjithçka që drejton një kompani ndërtimi, në një hapësirë pune.",
    lead: "Një bazë të dhënash, një sistem dizajni dhe një grup lejesh pas çdo departamenti — nga tenderi që fiton punën te llogaria që e mbyll.",
    requestAccess: "Kërko akses",
    seePricing: "Shihni çmimet",
    modules: {
      eyebrow: "Modulet",
      title: "Shtatëmbëdhjetë module dhe seksionet brenda tyre.",
      lead: "Çdo modul vjen me faqen, titullin, navigimin dhe panelin e vet. Skedat më poshtë janë ato ku ekipi juaj do të mbërrijë në të vërtetë.",
    },
    rolesNote:
      "Një rol është konfigurim, jo ekran. Navigimi, paneli dhe lejet e tij deklarohen një herë, dhe pastaj ai shfaqet në shiritin anësor, te cilësimet e roleve dhe te kontrollet e aksesit — kështu që rolet tuaja mund të shtohen pa shkruar asnjë rresht ndërfaqeje.",
    build: {
      eyebrow: "Ndërtimi",
      title: "Gjashtë faza, një regjistër.",
      lead: "Çdo fazë emërton modulet nëpër të cilat kalon, kështu që mbulimi mund të verifikohet në vend që të merret me besim.",
    },
    howItIsBuilt: {
      eyebrow: "Si është ndërtuar",
      title: "Arsyet pse mbetet i shpejtë ndërsa rritet.",
    },
  },

  /* ---------------------------------------------------------------- *
   * Security
   * ---------------------------------------------------------------- */

  security: {
    eyebrow: "Siguria",
    title: "Aksesi është vendim strukturor, jo një cilësim.",
    lead: "Të dhënat e ndërtimit janë të ndjeshme tregtarisht shumë kohë përpara se të jenë të ndjeshme ligjërisht — marzhet, pretendimet, incidentet, listëpagesat. NESTO e trajton aksesin si pjesë të arkitekturës, jo si një kuti zgjedhjeje në një ekran administrimi.",
    measures: [
      {
        title: "Leje që rrjedhin nga roli",
        copy: "Lejet gjenerohen nga navigimi i secilit rol. Dhënia e një moduli në shiritin anësor jep lejen e shikimit; heqja e tij e heq atë. Kodi i funksionaliteteve pyet nëse një leje zotërohet, kurrë se cili rol ka hyrë.",
      },
      {
        title: "E zbatuar dy herë",
        copy: "Çdo kërkesë kontrollohet në hyrje nga middleware, pastaj sërish brenda faqes ku mbërriti. Një faqe e shtuar pa rregull middleware mbetet e mbyllur, jo e hapur.",
      },
      {
        title: "Vetëm lexim do të thotë vetëm lexim",
        copy: "Roleve të shënuara vetëm për lexim u hiqet çdo leje përveç shikimit kur ndërtohen lejet, pavarësisht çfarë thotë një tabelë. Një Vëzhgues nuk mund të arrijë një faqe krijimi duke shkruar URL-në.",
      },
      {
        title: "Izolimi i kompanisë",
        copy: "Roli mbahet në anëtarësinë që lidh një person me një kompani, jo te personi. Të dhënat kufizohen në hapësirën e punës së kompanisë, dhe një llogari mund t'u përkasë disa kompanive me të drejta të ndryshme në secilën.",
      },
      {
        title: "Seanca që skadojnë",
        copy: "Hyrja lëshon një token të nënshkruar që mbart kompaninë dhe rolin, të vlefshëm për një ditë pune tetëorëshe. Hyrjet e dështuara kthejnë një mesazh të vetëm të përgjithshëm dhe nuk zbulojnë kurrë cila pjesë ishte e gabuar.",
      },
      {
        title: "Asgjë nga palë të treta në faqe",
        copy: "Pa skripte analitike, pa menaxherë etiketash, pa widget-e të ngulitura, pa fonte të jashtme që ngarkohen gjatë ekzekutimit. Njerëzit tuaj janë të vetmit që shohin hapësirën tuaj të punës.",
      },
    ],
    honesty: {
      eyebrow: "Qartë",
      title: "Çfarë nuk pretendojmë",
      copy: "NESTO ende nuk ka certifikim nga palë të treta, dhe nuk do të shfaqim një distinktiv që nuk e kemi fituar. Ajo që mund të bëjmë është t'ju tregojmë saktësisht si është ndërtuar kontrolli i aksesit dhe ta lëmë ekipin tuaj të IT-së ta gjykojë. Na pyesni, dhe do t'ua shpjegojmë rresht për rresht.",
    },
    questions: { eyebrow: "Pyetje", title: "Siguria dhe të dhënat." },
  },

  /* ---------------------------------------------------------------- *
   * Pricing
   * ---------------------------------------------------------------- */

  pricing: {
    eyebrow: "Çmimet",
    title: "Çmim për kompani. Kurrë për modul.",
    lead: "Çdo plan përfshin të shtatëmbëdhjetë modulet. Nuk ka version që e mban QA/QC-në mënjanë derisa të kaloni në një plan më të lartë, dhe nuk ka tarifë për përdorues që t'ju bëjë të mendoheni dy herë para se t'i jepni një llogari një kryepunëtori.",
    mostChosen: "Më i zgjedhuri",
    bespoke: "Me marrëveshje",
    plans: {
      studio: {
        name: "Studio",
        period: "për kompani / muaj",
        summary: "Për studio projektimi dhe kontraktorë që drejtojnë disa projekte njëkohësisht.",
        seats: "Deri në 25 përdorues",
        features: [
          "Të 17 modulet",
          "Të 18 hapësirat e punës sipas rolit",
          "Hapësirë pune dhe identitet vizual i kompanisë",
          "Kontroll i aktivizimit të moduleve",
          "Mbështetje me email",
        ],
        cta: "Kërko akses",
      },
      company: {
        name: "Kompani",
        period: "për kompani / muaj",
        summary:
          "Për kompani ndërtimi të konsoliduara që drejtojnë disa kantiere dhe departamente të plota.",
        seats: "Deri në 100 përdorues",
        features: [
          "Gjithçka në Studio",
          "Nisje e udhëhequr dhe ngritje e të dhënave",
          "Role të personalizuara dhe hartëzim i lejeve",
          "Mbështetje me përparësi",
          "Rishikim tremujor i platformës",
        ],
        cta: "Kërko akses",
      },
      enterprise: {
        name: "Korporatë",
        period: "marrëveshje vjetore",
        summary:
          "Për grupe që operojnë disa kompani, sipërmarrje të përbashkëta ose një mjedis të dedikuar.",
        seats: "Përdorues pa kufi",
        features: [
          "Gjithçka në Kompani",
          "Disa hapësira pune kompanie",
          "Mjedis i dedikuar",
          "Drejtues i caktuar i implementimit",
          "Marrëveshje për nivelin e shërbimit",
        ],
        cta: "Bisedoni me ne",
      },
    },
    footnotes: [
      "Ofrohen kushte vjetore dhe mujore. Plani vjetor faturohet një herë, me zbritje.",
      "Nisja përfshin ngritjen e kompanisë, rolet, përdoruesit dhe aktivizimin e moduleve.",
      "Nuk ka tarifë për një hapësirë pune ndërsa po ngrihet.",
    ],
    questions: { eyebrow: "Pyetje tregtare", title: "Para se të na pyesni." },
  },

  /* ---------------------------------------------------------------- *
   * About
   * ---------------------------------------------------------------- */

  about: {
    eyebrow: "Rreth nesh",
    title: "Softuer që respekton mënyrën si zhvillohet realisht një ndërtim.",
    lead: "Ndërtimi është gjëja më e koordinuar që bëjnë shumica e kompanive, dhe zakonisht koordinohet me softuerin më pak të koordinuar. NESTO ekziston për ta mbyllur këtë hendek.",
    sections: [
      {
        title: "Pse ekziston",
        body: [
          "Një projekt kalon nëpër një duzinë duarsh ndërmjet preventivit dhe llogarisë përfundimtare. Çdo dorë shton një dokument, një shifër dhe një vendim — dhe në shumicën e kompanive çdo dorë shton edhe një vend të ri ku ruhen ato.",
          "Kostoja nuk janë licencat e softuerit. Është java e humbur duke rakorduar katër versione të së njëjtës shifër, ndryshimi që nuk e regjistroi askush, certifikata që ishte në laptopin e dikujt kur klienti e kërkoi.",
          "NESTO nis nga premisa e kundërt: një sistem, një regjistër, një grup të drejtash mbi të. Gjithçka tjetër rrjedh prej kësaj.",
        ],
      },
      {
        title: "Çfarë besojmë",
        body: [
          "Roli i pari. Softueri duhet t'i tregojë një personi punën e vet, jo gjithë organigramën e kompanisë. Tetëmbëdhjetë role, tetëmbëdhjetë hapësira pune, një konfigurim pas tyre.",
          "Përmbajtja është veçori. Një paletë e kufizuar, një shkallë tipografike, një librari komponentësh. Ekranet që janë të mërzitshëm në të njëjtën mënyrë janë ekrane që i mëson një herë.",
          "Shpejtësia është respekt. Askush në kantier nuk ka durim për një ikonë ngarkimi. Faqet gjenerohen në server dhe i dërgojnë shfletuesit sa më pak që munden.",
          "Thuaj të vërtetën. Pa statistika të sajuara, pa logo të huazuara, pa distinktivë certifikimi që nuk i kemi fituar.",
        ],
      },
      {
        title: "Ku është NESTO sot",
        body: [
          "V0.1 është versioni themelor: një aplikacion, një sistem dizajni, një kornizë aplikacioni, një sistem modulesh dhe një konfigurim rolesh. Të tetëmbëdhjetë rolet hyjnë dhe punojnë nga këndvështrimi i tyre, dhe të shtatëmbëdhjetë modulet kanë faqen, titullin, navigimin dhe panelin e tyre të vërtetë.",
          "Funksionaliteti i moduleve po ndërtohet mbi këtë themel, modul pas moduli. Preferojmë t'jua themi qartë sesa t'ju shesim një pamje ekrani të diçkaje që ende nuk ekziston.",
          "Nëse doni të ndikoni në atë që ndërtohet më pas, kjo është pikërisht biseda që duhet të bëni me ne tani.",
        ],
      },
    ],
    principles: [
      { term: "Një sistem", copy: "Çdo departament në të njëjtën hapësirë pune, mbi të njëjtin regjistër." },
      { term: "Një dizajn", copy: "Një grup vlerash dizajni pas çdo ekrani, në modalitet të çelët dhe të errët." },
      { term: "Një grup rregullash", copy: "Aksesi rrjedh nga roli dhe zbatohet në çdo kërkesë." },
    ],
    mottoNote:
      "E njëjta fjali qëndron pranë datës në çdo panel të produktit. Nuk është slogan që e shkruam për këtë faqe — është ajo që softueri përpiqet të jetë.",
  },

  /* ---------------------------------------------------------------- *
   * Questions
   * ---------------------------------------------------------------- */

  faq: {
    eyebrow: "Pyetje",
    title: "Përgjigje të drejtpërdrejta, edhe për pyetjet e vështira.",
    lead: "Nëse mungon diçka që ju duhet, pyesni. Preferojmë t'ju themi që ende nuk është ndërtuar sesa ta zbuloni vetë në muajin e dytë.",
    stillUnanswered: "Ende pa përgjigje?",
    writeTo: "Na shkruani në",
    orAskDirectly: "ose na dërgoni pyetjen drejtpërdrejt.",
    askUs: "Na pyesni",
    groups: {
      platform: {
        title: "Platforma",
        items: [
          {
            question: "Çfarë është saktësisht NESTO?",
            answer:
              "Një ERP për ndërtimin: një hapësirë pune që mban projektet, detyrat, klientët, dokumentet, financat, burimet njerëzore, shitjet, kontratat, prokurimin, inventarin, QA/QC, HSE dhe administrimin e kompanisë. Jo një mjet projektesh i ngjitur pas një pakete kontabiliteti — një sistem i vetëm me një bazë të dhënash pas të gjithave.",
          },
          {
            question: "A është NESTO vetëm për ndërtimin?",
            answer:
              "Është ndërtuar për të. Grupi i moduleve është ai i një kompanie ndërtimi: prokurim me kërkesa për ofertë dhe tendera, inventar me lëvizje në kantier, QA/QC me mospërputhje dhe lista defektesh, HSE me leje pune dhe incidente. Një kompani jashtë ndërtimit do të paguante për një formë që nuk i duhet.",
          },
          {
            question: "Cilat module përfshihen?",
            answer:
              "Të shtatëmbëdhjetë, në çdo plan. Nuk ka version që e mban mënjanë një modul derisa të kaloni në një plan më të lartë, sepse kompania që nuk e përballon dot modulin e cilësisë është pikërisht kompania që ka nevojë për të.",
          },
          {
            question: "A mund ta çaktivizojmë një modul?",
            answer:
              "Po, për çdo kompani, nga Cilësimet. Një modul i çaktivizuar bëhet i paarritshëm, jo thjesht i fshehur: largohet nga shiriti anësor dhe ruteri i refuzon faqet e tij.",
          },
          {
            question: "A e zëvendëson softuerin tonë të kontabilitetit?",
            answer:
              "Zëvendëson anën operacionale — buxhetet, faturat, pagesat, shpenzimet dhe koston kundrejt vlerës për çdo projekt. Kontabiliteti statutor dhe deklarimet mbeten te kontabilisti juaj. NESTO është vendi ku prodhohen shifrat, jo ku auditohen.",
          },
          {
            question: "A funksionon në kantier?",
            answer:
              "I gjithë aplikacioni përshtatet deri në ekranin e telefonit. Nën gjerësinë e tabletit navigimi kalon në një panel anësor dhe struktura ngushtohet në një kolonë të vetme — të njëjtat ekrane, jo një version i reduktuar për celular.",
          },
        ],
      },
      access: {
        title: "Rolet dhe aksesi",
        items: [
          {
            question: "Si i marrin njerëzit llogaritë?",
            answer:
              "Administratori juaj i krijon brenda hapësirës së punës së kompanisë dhe cakton rolin. Nuk ka regjistrim publik: hapësira e punës e një kompanie ndërtimi nuk është diçka ku duhet të mund të hyjë kushdo.",
          },
          {
            question: "A mund të ketë një person dy role?",
            answer:
              "Një rol për çdo anëtarësi në kompani. Një person mund t'u përkasë disa kompanive me një rol të ndryshëm në secilën — e dobishme për grupe kompanish dhe sipërmarrje të përbashkëta.",
          },
          {
            question: "Çfarë mund të bëjë një llogari vetëm për lexim?",
            answer:
              "Të shohë, dhe asgjë tjetër. Roleve vetëm për lexim u hiqet çdo leje krijimi, redaktimi dhe fshirjeje kur ndërtohen lejet e tyre, kështu që një faqe krijimi refuzohet edhe nëse URL-ja shkruhet me dorë.",
          },
          {
            question: "A mund të shtojmë një rol tonin?",
            answer:
              "Po. Një rol është konfigurim — navigimi, paneli dhe lejet e tij deklarohen në një vend, dhe pastaj ai shfaqet në shiritin anësor, në ekranin e roleve dhe në kontrollet e aksesit pa u shkruar asnjë ekran.",
          },
        ],
      },
      security: {
        title: "Siguria dhe të dhënat",
        items: [
          {
            question: "Ku ruhen të dhënat tona?",
            answer:
              "Në hapësirën e punës së kompanisë suaj, të kufizuara te regjistri i kompanisë suaj. Roli që jep aksesin mbahet në anëtarësinë që lidh një person me atë kompani, kështu që asgjë nuk duket përtej një kufiri për të cilin nuk është dhënë akses.",
          },
          {
            question: "Si zbatohet aksesi?",
            answer:
              "Dy herë. Middleware kontrollon seancën dhe konfigurimin e rolit në hyrje, para se të arrihet faqja, dhe vetë faqja e kontrollon sërish lejen. Një faqe e shtuar pa rregull middleware mbetet e mbyllur.",
          },
          {
            question: "Sa zgjat një seancë?",
            answer: "Një ditë pune tetëorëshe, pastaj duhet të hyni përsëri.",
          },
          {
            question: "A trajnoni modele AI me të dhënat tona?",
            answer:
              "Jo. V0.1 nuk ka funksione AI dhe të dhënat tuaja nuk përdoren për të trajnuar asgjë, as nga ne, as nga kushdo tjetër.",
          },
          {
            question: "Çfarë ngarkoni nga palë të treta?",
            answer:
              "Asgjë gjatë ekzekutimit. Pa analitikë, pa menaxherë etiketash, pa widget-e të ngulitura. Faqja që po lexoni nuk ngarkon asnjë imazh dhe asnjë skript të jashtëm.",
          },
        ],
      },
      gettingStarted: {
        title: "Si të filloni",
        items: [
          {
            question: "Si përcaktohet çmimi i NESTO?",
            answer:
              "Për kompani, në muaj, me çdo modul të përfshirë dhe një kufi përdoruesish për çdo plan. Çmimet janë në faqen e çmimeve — nuk ju duhet ofertë për të parë një shifër.",
          },
          {
            question: "A mund ta shohim para se të angazhohemi?",
            answer:
              "Po. Kërkoni një prezantim dhe do t'ju shoqërojmë nëpër një hapësirë pune funksionale nga këndvështrimi i cilitdo prej tetëmbëdhjetë roleve, që të shihni atë që do të shihnin njerëzit tuaj.",
          },
          {
            question: "Çfarë përfshin nisja?",
            answer:
              "Hapësirën e punës së kompanisë suaj, rolet, përdoruesit dhe modulet që doni të aktivizoni. Planet Kompani përfshijnë ngritje të udhëhequr; hapësira e punës nuk faturohet ndërsa përgatitet.",
          },
          {
            question: "Sa të sinqertë jeni për atë që është gati?",
            answer:
              "Plotësisht. V0.1 është themeli strukturor — çdo modul ka faqen, navigimin, titullin dhe panelin e vet, dhe funksionaliteti po ndërtohet mbi to, modul pas moduli. Nëse një funksion që ju duhet nuk është ndërtuar, do t'ju themi kur do të jetë gati, në vend që t'ju tregojmë një maketë.",
          },
        ],
      },
    },
  },

  /* ---------------------------------------------------------------- *
   * Contact
   * ---------------------------------------------------------------- */

  contact: {
    eyebrow: "Kontakt",
    title: "Na tregoni për kompaninë tuaj dhe projektin tuaj të ardhshëm.",
    lead: "Një prezantim është bisedë, jo skenar demonstrimi. Na tregoni çfarë ndërtoni dhe sa persona duhet ta shohin, dhe do t'ju tregojmë hapësirën e punës që do të merrnin realisht.",
    writeDirectly: "Ose shkruani drejtpërdrejt",
    channels: {
      newCompanies: { label: "Kompani të reja", note: "Akses, çmime dhe prezantime." },
      customers: {
        label: "Klientë ekzistues",
        note: "Administratori juaj mund ta ngrejë çështjen edhe te Mbështetja.",
      },
      general: { label: "Për gjithçka tjetër", note: "Partneritete, shtyp dhe pyetje të përgjithshme." },
    },
    account: {
      title: "Keni tashmë një llogari?",
      copy: "Hyni në hapësirën e punës së kompanisë suaj. Aksesi krijohet nga administratori juaj, ndaj ai është rruga më e shpejtë për një llogari të re ose një rol të ndryshuar.",
      link: "Hyr në NESTO",
    },

    form: {
      name: "Emri",
      namePlaceholder: "Arta Hoxha",
      email: "Emaili i punës",
      emailPlaceholder: "ju@kompania.com",
      company: "Kompania",
      companyPlaceholder: "Meridian Ndërtim",
      size: "Madhësia e kompanisë",
      sizePlaceholder: "Zgjidhni madhësinë",
      topic: "Për çfarë bëhet fjalë?",
      topicPlaceholder: "Zgjidhni temën",
      message: "Mesazhi",
      messagePlaceholder: "Çfarë ndërtoni, sa persona kanë nevojë për akses dhe çfarë përdorni sot?",
      website: "Faqja e internetit",
      topics: {
        access: "Kërko akses",
        walkthrough: "Rezervo një prezantim",
        pricing: "Çmimet dhe planet",
        security: "Rishikim sigurie",
        other: "Diçka tjetër",
      },
      sizes: {
        "1-10": "1–10 persona",
        "11-50": "11–50 persona",
        "51-200": "51–200 persona",
        "200+": "Më shumë se 200 persona",
      },
      submit: "Dërgo mesazhin",
      sending: "Duke dërguar…",
      sentTitle: "Mesazhi u mor.",
      urgentBefore: "Nëse është urgjente, shkruani në",
      urgentAfter: "dhe do të mbërrijë te të njëjtët persona.",
      sendAnother: "Dërgo një mesazh tjetër",
      errors: {
        nameRequired: "Shkruani emrin tuaj",
        nameTooLong: "Ky emër është shumë i gjatë",
        emailRequired: "Shkruani emailin tuaj të punës",
        emailInvalid: "Shkruani një adresë emaili të vlefshme",
        emailTooLong: "Kjo adresë emaili është shumë e gjatë",
        companyRequired: "Shkruani kompaninë tuaj",
        companyTooLong: "Ky emër është shumë i gjatë",
        sizeRequired: "Zgjidhni madhësinë e kompanisë",
        topicRequired: "Zgjidhni për çfarë bëhet fjalë",
        messageTooShort: "Një ose dy fjali, që të mund t'ju përgjigjemi siç duhet",
        messageTooLong: "Ju lutemi mbajeni nën 2000 karaktere",
        invalid: "Mungojnë disa të dhëna. Kontrolloni formularin dhe provoni përsëri.",
        failed: "Nuk arritëm ta dërgojmë. Ju lutemi na shkruani drejtpërdrejt me email.",
      },
    },
  },

  /* ---------------------------------------------------------------- *
   * Closing call to action
   * ---------------------------------------------------------------- */

  closingCta: {
    eyebrow: "Një hapësirë pune",
    headline: ["Sillni gjithë kompaninë", "në një sistem të vetëm."],
    lead: "Projektet, prokurimi, cilësia, siguria, njerëzit dhe financat — nën një çati, me një grup të drejtash mbi to.",
    primary: "Kërko akses",
    secondary: "Shihni platformën",
  },

  /* ---------------------------------------------------------------- *
   * Legal
   * ---------------------------------------------------------------- */

  legal: {
    lastUpdated: "Përditësuar së fundi",

    privacy: {
      eyebrow: "Privatësia",
      title: "Çfarë mbledhim, që është shumë pak.",
      lead: "NESTO është një hapësirë pune për të cilën paguan kompania juaj. Kjo i bën të dhënat tuaja pasurinë tuaj dhe përgjegjësinë tonë — jo një produkt të dytë që e shesim në heshtje.",
      updated: "shtator 2026",
      note: "Kjo është një përmbledhje në gjuhë të thjeshtë e mënyrës si NESTO trajton të dhënat. Kushtet detyruese janë në marrëveshjen për përpunimin e të dhënave që shoqëron një kontratë të nënshkruar — kërkojeni dhe do t'jua dërgojmë para se të nënshkruani çfarëdo.",
      sections: [
        {
          title: "Kjo faqe publike",
          body: [
            "Faqet që po lexoni nuk mbledhin asgjë. Nuk ka skript analitik, menaxher etiketash, piksel reklamash, widget të ngulitur apo kërkesë për fonte të jashtme gjatë ekzekutimit. Asnjë cookie nuk vendoset para se të hyni, përveç atij që mban mend gjuhën që zgjidhni, nëse zgjidhni një.",
            "I vetmi informacion që merr kjo faqe është ai që zgjidhni ta shkruani në formularin e kontaktit.",
          ],
        },
        {
          title: "Formulari i kontaktit",
          body: [
            "Emri, emaili i punës, kompania, madhësia e kompanisë, tema dhe mesazhi juaj. I përdorim për t'ju përgjigjur dhe për të përgatitur një hapësirë pune nëse e kërkoni.",
            "Nuk shiten kurrë, nuk përdoren kurrë për reklama dhe nuk ndahen kurrë jashtë personave që ju përgjigjen.",
          ],
        },
        {
          title: "Brenda aplikacionit",
          body: [
            "Administratori i kompanisë suaj krijon llogaritë dhe cakton rolet, kështu që të dhënat e llogarisë në NESTO janë ato që kompania juaj zgjodhi të vendosë aty: emri, emaili i punës, departamenti, pozicioni, roli dhe regjistrimet që krijon ekipi juaj gjatë punës.",
            "Hyrja vendos një cookie thelbësor që mban një token seance të nënshkruar me kompaninë dhe rolin tuaj. Ai skadon pas një dite pune tetëorëshe. Nuk ka cookie analitikë apo reklamash askund në produkt.",
            "Të dhënat tuaja nuk përdoren për të trajnuar asnjë model, as tonin, as të askujt tjetër.",
          ],
        },
        {
          title: "Të drejtat tuaja",
          body: [
            "Mund të pyesni çfarë mbajmë, të kërkoni që të korrigjohet dhe të kërkoni që të fshihet. Nëse jeni përdorues dhe jo mbajtësi i llogarisë, administratori i kompanisë suaj mund ta bëjë pjesën më të madhe të kësaj drejtpërdrejt te Cilësimet.",
            "Na shkruani dhe do t'ju përgjigjet një person.",
          ],
        },
      ],
    },

    terms: {
      eyebrow: "Kushtet",
      title: "Si ofrohet NESTO.",
      lead: "Një përmbledhje e marrëveshjes, në rendin në të cilin zakonisht dalin pyetjet. Versioni detyrues është kontrata që nënshkruan kompania juaj.",
      updated: "shtator 2026",
      note: "Kjo faqe përmbledh kushtet me të cilat ofrohet NESTO. Nuk është vetë marrëveshja, dhe asgjë këtu nuk mbizotëron mbi një kontratë të nënshkruar.",
      sections: [
        {
          title: "Aksesi",
          body: [
            "NESTO ofrohet për kompani. Administratori juaj krijon llogaritë, cakton rolet dhe aktivizon ose çaktivizon modulet brenda hapësirës suaj të punës.",
            "Nuk ka regjistrim publik, dhe llogaritë janë për persona me emër. Ndarja e një hyrjeje të vetme mes një skuadre anulon çdo kontroll aksesi të përshkruar në faqen e sigurisë.",
          ],
        },
        {
          title: "Të dhënat tuaja",
          body: [
            "Gjithçka që kompania juaj vendos në NESTO i përket kompanisë suaj. E mbajmë për të ofruar shërbimin për të cilin paguani dhe për asnjë qëllim tjetër.",
            "Nëse largoheni, mund t'i merrni me vete, dhe ne fshijmë atë që mbetet sipas afateve të përcaktuara në marrëveshje.",
          ],
        },
        {
          title: "Përdorimi i drejtë",
          body: [
            "Përdoreni NESTO për biznesin tuaj të ndërtimit. Mos u përpiqni të shkelni kontrollet e aksesit, të rishisni aksesin ose të ngarkoni diçka të paligjshme.",
            "Mund të pezullojmë një llogari që vë në rrezik platformën ose një kompani tjetër, dhe do t'ju tregojmë arsyen.",
          ],
        },
        {
          title: "Disponueshmëria dhe ndryshimet",
          body: [
            "Synojmë që platforma të jetë e disponueshme sa herë që ekipet tuaja punojnë, dhe marrëveshjet Korporatë përmbajnë një nivel shërbimi me shifra konkrete.",
            "Produkti ndryshon ndërsa modulet ndërtohen. Ndryshimet që heqin diçka mbi të cilën mbështeteni njoftohen para se të ndodhin, jo pas.",
          ],
        },
        {
          title: "Tarifat dhe afati",
          body: [
            "Planet faturohen për kompani, mujorisht ose vjetorisht, me tarifat në faqen e çmimeve. Një hapësirë pune nuk faturohet ndërsa po ngrihet.",
            "Secila palë mund ta përfundojë marrëveshjen në fund të një afati. Nuk i mbajmë peng të dhënat tuaja për një rinovim.",
          ],
        },
      ],
    },
  },
};
