import type { Locale } from "@/lib/i18n/config";

/**
 * Words for the Full View page (Landing + Full View PRD §51-§66) that the old
 * home page did not already carry: the section navigator, Group architecture,
 * ROZARIS, the pricing overview and the questions of §64. Everything else on
 * the page is the former home page's copy in lib/i18n/site/{en,sq}.ts, with
 * its legacy "every module on every plan" claims corrected (§56).
 */
const en = {
  meta: {
    title: "NESTO Full View — Complete Construction ERP Platform",
    description: "Explore NESTO modules, roles, construction workflows, Group architecture, ROZARIS, security and the full platform lifecycle.",
  },
  eyebrow: "Full View",
  lead: "Everything NESTO can do, in detail.",
  nav: {
    label: "On this page",
    jump: "Jump to section",
    overview: "Overview",
    problem: "Problem",
    modules: "Modules",
    roles: "Roles",
    lifecycle: "Lifecycle",
    group: "Group",
    experience: "Experience",
    security: "Security",
    rozaris: "ROZARIS",
    pricing: "Pricing",
    faq: "Questions",
  },
  modulesNote: "NESTO is modular. Companies activate the functions they need, while shared records and permissions keep the selected modules connected.",
  rolesLink: "See role details",
  group: {
    eyebrow: "Company & Group architecture",
    title: "One Group above the companies. Each company still itself.",
    lead: "NESTO models how construction and property groups are actually organised — a parent Group, the legal companies beneath it, the departments that serve them and the projects each company owns.",
    layers: [
      { title: "Parent Group", copy: "Holds the central departments — Finance, Legal, Procurement, Architecture, HR — that serve every company." },
      { title: "Companies", copy: "Each legal company keeps its own name, registration, people and projects, without becoming a separate system." },
      { title: "Departments", copy: "A Group department reaches exactly the companies and projects it has been given, and nothing else." },
      { title: "Projects", copy: "Every project belongs to the company that owns it. Group visibility never erases that boundary." },
      { title: "Users", copy: "One account per person, with layered memberships: Group, company and project, each with its own role." },
    ],
    crossTitle: "Cross-company roles",
    crossCopy: "A person in Group Finance can review invoices for two companies and one project with the same account, while a third company stays out of reach. Access is decided by membership and role, never by who happens to have a file.",
  },
  rozaris: {
    eyebrow: "ROZARIS",
    title: "The Unit you sell is the Unit in the ERP.",
    lead: "ROZARIS is NESTO's sales environment for developers: Units, buyers, contracts and the published 3D project, all on the same records.",
    items: [
      { title: "Units", copy: "Apartments, villas, shops and parking created once inside the project, with area, floor, price and status." },
      { title: "Contracts", copy: "Reservations, sale contracts and payment schedules attached to the exact Unit and buyer." },
      { title: "Clients and buyers", copy: "Every buyer linked to the Units they reserve or buy, with the history Sales, Legal and Finance share." },
      { title: "3D project viewer", copy: "The published 3D project reads the same Units, so availability in the viewer is availability in the ERP." },
    ],
    principle: "The same Unit can be used by Sales, Legal, Finance and the published 3D experience.",
    pricing: "See pricing",
    story: "Explore the developer story",
  },
  pricing: {
    eyebrow: "Pricing model",
    title: "Build the NESTO your company needs.",
    lead: "Pricing is modular. You choose what you use, and the price follows the choice.",
    steps: ["Choose your foundation", "Choose modules", "Add companies", "Add projects", "Add users", "Choose your contract"],
    cta: "Build your price",
  },
  faq: {
    eyebrow: "Questions",
    title: "What people ask before they start.",
    items: [
      { question: "What exactly is NESTO?", answer: "An operating system for construction and real-estate companies: one workspace for projects, tasks, documents, finance, HR, sales, legal, procurement, inventory, QA/QC, HSE and company administration, with one database and one permission system behind all of it." },
      { question: "Who is NESTO for?", answer: "Developers selling Units, contractors delivering on site, and Groups running several legal companies with central departments." },
      { question: "Which modules are available?", answer: "Work modules such as Projects, Tasks, Meetings, Timesheets, Daily Logs, Workforce, Contractors, Engineering, Clients and Documents; department modules such as Finance, HR, Sales, Legal, Procurement, Inventory, QA/QC and HSE; and company modules such as People, Team, Organization and Settings. Companies activate the ones they need." },
      { question: "Can I use only ROZARIS?", answer: "Yes. ROZARIS is a foundation of its own for developers who need Units, buyers, contracts and the 3D project first. The wider platform can be added later on the same records." },
      { question: "Can I activate modules later?", answer: "Yes. A module added later starts from the records you already have — the same company, projects, people and Units." },
      { question: "How are users managed?", answer: "Your administrator creates accounts and assigns each person a role at Group, company or project level. People sign in with a username and password; access follows the role." },
      { question: "Does it work on site?", answer: "Yes. NESTO is a responsive web application, so daily logs, inspections, tasks and approvals work from a phone or tablet on site." },
      { question: "Can Group departments work across companies?", answer: "Yes, within the scope they are given. A Group department reaches the companies and projects it is a member of, and nothing else." },
      { question: "How does access work?", answer: "By role and scope. What a person can see and do is decided by their memberships, and every request is checked on the server — hiding a button is never the only protection, and read-only stays read-only." },
      { question: "How is NESTO priced?", answer: "Modularly: a foundation, the modules you need, your companies, projects, users and contract term. The pricing page calculates it as you build — no quote required to see a number." },
      { question: "Is 3D production included with ROZARIS?", answer: "ROZARIS publishes and connects your 3D project to the Units in NESTO. Producing the 3D model itself is a separate service; ask us and we will scope it with you." },
    ],
  },
};

export type FullViewCopy = typeof en;

const sq: FullViewCopy = {
  meta: {
    title: "NESTO Pamja e plotë — Platforma e plotë ERP për ndërtimin",
    description: "Eksploroni modulet, rolet, proceset e ndërtimit, arkitekturën e Grupit, ROZARIS, sigurinë dhe gjithë ciklin e platformës NESTO.",
  },
  eyebrow: "Pamja e plotë",
  lead: "Gjithçka që NESTO mund të bëjë, në detaje.",
  nav: {
    label: "Në këtë faqe",
    jump: "Kalo te seksioni",
    overview: "Përmbledhje",
    problem: "Problemi",
    modules: "Modulet",
    roles: "Rolet",
    lifecycle: "Cikli",
    group: "Grupi",
    experience: "Përvoja",
    security: "Siguria",
    rozaris: "ROZARIS",
    pricing: "Çmimet",
    faq: "Pyetje",
  },
  modulesNote: "NESTO është modular. Kompanitë aktivizojnë funksionet që u duhen, ndërsa regjistrat dhe lejet e përbashkëta i mbajnë modulet e zgjedhura të lidhura.",
  rolesLink: "Shikoni detajet e roleve",
  group: {
    eyebrow: "Arkitektura e kompanisë dhe Grupit",
    title: "Një Grup mbi kompanitë. Çdo kompani mbetet vetvetja.",
    lead: "NESTO modelon mënyrën si organizohen realisht grupet e ndërtimit dhe pronave — një Grup mëmë, kompanitë ligjore nën të, departamentet që u shërbejnë dhe projektet që zotëron secila kompani.",
    layers: [
      { title: "Grupi mëmë", copy: "Mban departamentet qendrore — Financën, Ligjoren, Prokurimin, Arkitekturën, Burimet njerëzore — që u shërbejnë të gjitha kompanive." },
      { title: "Kompanitë", copy: "Çdo kompani ligjore ruan emrin, regjistrimin, njerëzit dhe projektet e veta, pa u bërë sistem më vete." },
      { title: "Departamentet", copy: "Një departament i Grupit arrin pikërisht kompanitë dhe projektet që i janë dhënë, dhe asgjë tjetër." },
      { title: "Projektet", copy: "Çdo projekt i përket kompanisë që e zotëron. Pamja e Grupit nuk e fshin kurrë atë kufi." },
      { title: "Përdoruesit", copy: "Një llogari për person, me anëtarësi në shtresa: Grup, kompani dhe projekt, secila me rolin e vet." },
    ],
    crossTitle: "Role ndër-kompani",
    crossCopy: "Një person në Financën e Grupit mund të shqyrtojë faturat e dy kompanive dhe të një projekti me të njëjtën llogari, ndërsa një kompani e tretë mbetet jashtë qasjes. Qasja vendoset nga anëtarësia dhe roli, jo nga kush e ka rastësisht një skedar.",
  },
  rozaris: {
    eyebrow: "ROZARIS",
    title: "Njësia që shisni është Njësia në ERP.",
    lead: "ROZARIS është mjedisi i shitjeve i NESTO-s për zhvilluesit: Njësi, blerës, kontrata dhe projekti 3D i publikuar, të gjitha mbi të njëjtat regjistra.",
    items: [
      { title: "Njësitë", copy: "Apartamente, vila, dyqane dhe parkime të krijuara një herë brenda projektit, me sipërfaqe, kat, çmim dhe status." },
      { title: "Kontratat", copy: "Rezervime, kontrata shitjeje dhe grafikë pagesash të lidhura me Njësinë dhe blerësin e saktë." },
      { title: "Klientët dhe blerësit", copy: "Çdo blerës i lidhur me Njësitë që rezervon ose blen, me historinë që ndajnë Shitjet, Ligjorja dhe Financa." },
      { title: "Shikuesi 3D i projektit", copy: "Projekti 3D i publikuar lexon të njëjtat Njësi, kështu që disponueshmëria në shikues është disponueshmëria në ERP." },
    ],
    principle: "E njëjta Njësi mund të përdoret nga Shitjet, Ligjorja, Financa dhe përvoja 3D e publikuar.",
    pricing: "Shikoni çmimet",
    story: "Eksploroni historinë e zhvilluesit",
  },
  pricing: {
    eyebrow: "Modeli i çmimeve",
    title: "Ndërtoni NESTO-n që i duhet kompanisë suaj.",
    lead: "Çmimet janë modulare. Ju zgjidhni çfarë përdorni dhe çmimi ndjek zgjedhjen.",
    steps: ["Zgjidhni bazën", "Zgjidhni modulet", "Shtoni kompanitë", "Shtoni projektet", "Shtoni përdoruesit", "Zgjidhni kontratën"],
    cta: "Ndërtoni çmimin tuaj",
  },
  faq: {
    eyebrow: "Pyetje",
    title: "Çfarë pyesin njerëzit para se të fillojnë.",
    items: [
      { question: "Çfarë është saktësisht NESTO?", answer: "Një sistem operativ për kompanitë e ndërtimit dhe pasurive të paluajtshme: një hapësirë pune për projektet, detyrat, dokumentet, financën, burimet njerëzore, shitjet, ligjoren, prokurimin, inventarin, QA/QC, HSE dhe administrimin e kompanisë, me një bazë të dhënash dhe një sistem lejesh pas të gjithave." },
      { question: "Për kë është NESTO?", answer: "Për zhvilluesit që shesin Njësi, kontraktorët që realizojnë në kantier dhe Grupet që drejtojnë disa kompani ligjore me departamente qendrore." },
      { question: "Cilat module janë në dispozicion?", answer: "Module pune si Projektet, Detyrat, Takimet, Fletët e kohës, Ditarët e kantierit, Fuqia punëtore, Kontraktorët, Inxhinieria, Klientët dhe Dokumentet; module departamentesh si Financa, Burimet njerëzore, Shitjet, Ligjorja, Prokurimi, Inventari, QA/QC dhe HSE; dhe module kompanie si Njerëzit, Ekipi, Organizata dhe Cilësimet. Kompanitë aktivizojnë ato që u duhen." },
      { question: "A mund të përdor vetëm ROZARIS?", answer: "Po. ROZARIS është një bazë më vete për zhvilluesit që kanë nevojë fillimisht për Njësi, blerës, kontrata dhe projektin 3D. Platforma më e gjerë mund të shtohet më vonë mbi të njëjtat regjistra." },
      { question: "A mund të aktivizoj module më vonë?", answer: "Po. Një modul i shtuar më vonë nis nga regjistrat që keni tashmë — e njëjta kompani, projekte, njerëz dhe Njësi." },
      { question: "Si menaxhohen përdoruesit?", answer: "Administratori juaj krijon llogaritë dhe i cakton çdo personi një rol në nivel Grupi, kompanie ose projekti. Njerëzit hyjnë me emër përdoruesi dhe fjalëkalim; qasja ndjek rolin." },
      { question: "A funksionon në kantier?", answer: "Po. NESTO është një aplikacion web që përshtatet me ekranin, kështu që ditarët, inspektimet, detyrat dhe miratimet punojnë nga telefoni ose tableti në kantier." },
      { question: "A mund të punojnë departamentet e Grupit në disa kompani?", answer: "Po, brenda shtrirjes që u jepet. Një departament i Grupit arrin kompanitë dhe projektet ku është anëtar, dhe asgjë tjetër." },
      { question: "Si funksionon qasja?", answer: "Sipas rolit dhe shtrirjes. Çfarë mund të shohë dhe bëjë një person vendoset nga anëtarësitë e tij, dhe çdo kërkesë kontrollohet në server — fshehja e një butoni nuk është kurrë mbrojtja e vetme, dhe vetëm-lexim mbetet vetëm-lexim." },
      { question: "Si çmohet NESTO?", answer: "Në mënyrë modulare: një bazë, modulet që ju duhen, kompanitë, projektet, përdoruesit dhe kohëzgjatja e kontratës. Faqja e çmimeve e llogarit ndërsa ndërtoni — nuk ju duhet ofertë për të parë një shifër." },
      { question: "A përfshihet prodhimi 3D me ROZARIS?", answer: "ROZARIS publikon dhe lidh projektin tuaj 3D me Njësitë në NESTO. Prodhimi i vetë modelit 3D është shërbim më vete; na pyesni dhe e përcaktojmë bashkë." },
    ],
  },
};

export const fullViewCopy: Record<Locale, FullViewCopy> = { en, sq };
