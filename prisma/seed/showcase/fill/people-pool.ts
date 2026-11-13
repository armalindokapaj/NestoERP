/**
 * Invented buyers, tenants and firms for the selling demo: common Albanian
 * names mixed at random, mail at `.test` addresses and phone numbers in the
 * standard seed's 000 range, so none can be mistaken for, or reach, a real
 * person or company.
 */
import type { Random } from "./kit";

const MEN = ["Arben", "Bledi", "Dritan", "Elton", "Fatos", "Gëzim", "Ilir", "Klodian", "Marsel", "Nertil", "Olsi", "Redi", "Sokol", "Taulant", "Valon", "Ervis", "Gerti", "Julian", "Mario", "Orges", "Saimir", "Endri", "Florian", "Kastriot", "Lorenc", "Mikel", "Paulin", "Rigers"];
const WOMEN = ["Alba", "Brikena", "Dorina", "Elona", "Flutura", "Ina", "Jonida", "Klaudia", "Lediana", "Mirela", "Nertila", "Oriana", "Rezarta", "Silva", "Vjosa", "Blerta", "Enkelejda", "Fjorela", "Greta", "Erjona", "Sidorela", "Anisa", "Desara", "Iris", "Livia", "Rovena"];
const SURNAMES = ["Hoxha", "Shehu", "Krasniqi", "Berisha", "Murati", "Dibra", "Toska", "Shkurti", "Mehmeti", "Ndreu", "Prendi", "Gjoka", "Vrioni", "Topalli", "Duka", "Bregu", "Nika", "Pllumi", "Hasa", "Kuqi", "Malaj", "Zogaj", "Sula", "Tare", "Vasili", "Bajrami", "Cenaj", "Allmuça", "Frashëri", "Marku", "Pepa", "Qorri", "Ruka", "Sinani", "Tafaj", "Xhafa", "Ymeri", "Zhupa", "Kodra", "Lami"];

const HOME_TOWNS = [
  { city: "Tiranë", country: "Albania" },
  { city: "Durrës", country: "Albania" },
  { city: "Vlorë", country: "Albania" },
  { city: "Elbasan", country: "Albania" },
  { city: "Korçë", country: "Albania" },
  { city: "Fier", country: "Albania" },
  { city: "Shkodër", country: "Albania" },
  { city: "Prishtinë", country: "Kosovo" },
];
const ABROAD = [
  { city: "Milano", country: "Italy" },
  { city: "London", country: "United Kingdom" },
  { city: "München", country: "Germany" },
  { city: "New York", country: "United States" },
  { city: "Athinë", country: "Greece" },
  { city: "Zürich", country: "Switzerland" },
  { city: "Bruxelles", country: "Belgium" },
  { city: "Toronto", country: "Canada" },
];

const FIRM_PLACES = ["Vjosa", "Prespa", "Tomori", "Llogara", "Osumi", "Drini", "Butrint", "Shkumbin", "Valbona", "Dajti", "Erzeni", "Semani", "Gjallica", "Korabi", "Ishmi", "Mati"];
const FIRM_TRADES = ["Freight", "Pharma", "Data", "Foods", "Logistics", "Insurance Brokers", "Tech", "Trading", "Studio", "Consulting", "Distribution", "Medical", "Legal Partners", "Audit", "Retail", "Cold Chain"];

export type Buyer = {
  kind: "INDIVIDUAL" | "COMPANY";
  name: string;
  legalName: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  abroad: boolean;
};

const ascii = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ç/gi, "c").replace(/ë/gi, "e").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Draws invented people and firms, never the same name twice in one pool. */
export class BuyerPool {
  private readonly used = new Set<string>();
  private phone = 0;

  constructor(
    private readonly rand: Random,
    phoneBase: number,
  ) {
    this.phone = phoneBase;
  }

  private nextPhone() {
    this.phone += 1;
    return `+355 69 000 ${String(this.phone).padStart(4, "0")}`;
  }

  person(abroadShare = 0.2): Buyer {
    for (;;) {
      const woman = this.rand.chance(0.5);
      const firstName = this.rand.pick(woman ? WOMEN : MEN);
      const lastName = this.rand.pick(SURNAMES);
      const name = `${firstName} ${lastName}`;
      if (this.used.has(name)) continue;
      this.used.add(name);
      const abroad = this.rand.chance(abroadShare);
      const home = this.rand.pick(abroad ? ABROAD : HOME_TOWNS);
      return { kind: "INDIVIDUAL", name, legalName: null, firstName, lastName, email: `${ascii(firstName)}.${ascii(lastName)}@post.test`, phone: this.nextPhone(), ...home, abroad };
    }
  }

  firm(trades: readonly string[] = FIRM_TRADES): Buyer {
    for (;;) {
      const name = `${this.rand.pick(FIRM_PLACES)} ${this.rand.pick(trades)}`;
      if (this.used.has(name)) continue;
      this.used.add(name);
      const contact = this.person(0);
      this.used.delete(contact.name);
      const home = this.rand.pick(HOME_TOWNS.slice(0, 3));
      return { kind: "COMPANY", name, legalName: `${name} sh.p.k.`, firstName: contact.firstName, lastName: contact.lastName, email: `info@${ascii(name)}.test`, phone: this.nextPhone(), ...home, abroad: false };
    }
  }
}
