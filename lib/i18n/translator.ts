import type { Locale } from "./config";
import type { Messages } from "./messages/en";

export type Namespace = keyof Messages;

/** Every dotted path to a string inside a dictionary branch. */
type Leaves<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Leaves<T[K]>}`;
}[keyof T & string];

/** `modulesCount_one` and `modulesCount_other` are called as `modulesCount`. */
type PluralBase<K extends string> = K extends `${infer Base}_one`
  ? Base
  : K extends `${infer Base}_other`
    ? Base
    : K;

export type MessageKey<N extends Namespace> = PluralBase<Leaves<Messages[N]>>;

export type MessageValues = Record<string, string | number>;

export type Translate<N extends Namespace> = (key: MessageKey<N>, values?: MessageValues) => string;

function lookup(branch: unknown, path: string): string | undefined {
  let node = branch;
  for (const segment of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * A `t` bound to one namespace of one dictionary.
 *
 * Pure, so the server helper and the client hook share it: the only difference
 * between them is where the locale comes from. A key that resolves to nothing
 * returns the key itself — visible, but never a crash.
 */
export function createTranslator<N extends Namespace>(
  locale: Locale,
  dictionary: Messages[N],
): Translate<N> {
  const plurals = new Intl.PluralRules(locale);

  return (key, values) => {
    const count = values?.count;
    const template =
      (typeof count === "number"
        ? (lookup(dictionary, `${key}_${plurals.select(count)}`) ??
          lookup(dictionary, `${key}_other`))
        : undefined) ??
      lookup(dictionary, key) ??
      key;

    if (!values) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in values ? String(values[name]) : match,
    );
  };
}
