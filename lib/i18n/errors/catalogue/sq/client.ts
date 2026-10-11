import type { Catalogue } from "@/lib/i18n/catalogue";

/**
 * Albanian for the text the browser itself raises: the request helper's and the save outcome's own
 * sentences, and what the shared form parsers (lib/forms) say while a person types.
 *
 * Nothing here may import the server: this file is bundled for the browser (lib/i18n/errors/client.ts).
 * Every row is the same row as in sq/shared.ts, which serves the server's answers; a test holds the
 * two in step. The sentences with a label in a hole carry none of shared.ts's `slots`: the label the
 * parser is handed is already the one the form shows, and the browser has no term table to look it up in.
 */
export const rows = {
  "Check your connection and try again.": "Kontrolloni lidhjen tuaj dhe provoni përsëri.",
  "This is taking longer than expected. Try again.": "Po zgjat më shumë se pritej. Provoni përsëri.",
  "The request was replaced by a newer one.": "Kërkesa u zëvendësua nga një më e re.",
  "Too many requests. Try again in a moment.": "Shumë kërkesa. Provoni përsëri pas pak.",
  "Something went wrong.": "Diçka shkoi keq.",
  "Too many requests. Try again in {0} seconds.": "Shumë kërkesa. Provoni përsëri pas {0} sekondash.",
  "Enter {0}.": "Vendosni fushën “{0}”.",
  "Enter a {0}.": "Vendosni fushën “{0}”.",
  "Enter an {0}.": "Vendosni fushën “{0}”.",
  "{0} must be a date like 2026-09-27.": "Fusha “{0}” duhet të jetë një datë si 2026-09-27.",
  "{0} {1} is not a real date. Check the day and the month.": "Fusha “{0}” me vlerën “{1}” nuk është datë reale. Kontrolloni ditën dhe muajin.",
  "{0} must be on or after {1}.": "Fusha “{0}” duhet të jetë në datën {1} ose më pas.",
  "{0} must be on or before {1}.": "Fusha “{0}” duhet të jetë në datën {1} ose më parë.",
  "{0} \"{1}\" is not a number. Use digits and one decimal separator, e.g. {2}.": "Fusha “{0}” me vlerën “{1}” nuk është numër. Përdorni shifra dhe një ndarës dhjetor, p.sh. {2}.",
  "{0} \"{1}\" is not a number. Write it in full, without an exponent, e.g. {2}.": "Fusha “{0}” me vlerën “{1}” nuk është numër. Shkruajeni të plotë, pa eksponent, p.sh. {2}.",
  "{0} \"{1}\" mixes a point and a comma. Use one decimal separator and no thousands separator, e.g. {2}.": "Fusha “{0}” me vlerën “{1}” përzien pikën dhe presjen. Përdorni një ndarës dhjetor dhe asnjë ndarës mijësh, p.sh. {2}.",
  "{0} \"{1}\" has more than one separator. Write it without thousands separators, e.g. {2}.": "Fusha “{0}” me vlerën “{1}” ka më shumë se një ndarës. Shkruajeni pa ndarës mijësh, p.sh. {2}.",
  "{0} \"{1}\" is ambiguous: write {2}{3} for {4} thousand {5}, or {6}.{7} for {8} point {9}.": "Fusha “{0}” me vlerën “{1}” është e paqartë: shkruani {2}{3} për {4} mijë {5}, ose {6}.{7} për {8} pikë {9}.",
  "{0} cannot be negative.": "Fusha “{0}” nuk mund të jetë negative.",
  "{0} can have at most {1} decimal place, e.g. {3}.": "Fusha “{0}” mund të ketë më së shumti {1} shifër dhjetore, p.sh. {3}.",
  "{0} can have at most {1} decimal places, e.g. {3}.": "Fusha “{0}” mund të ketë më së shumti {1} shifra dhjetore, p.sh. {3}.",
  "{0} is too large: at most {1} digits before the decimal point.": "Fusha “{0}” është shumë e madhe: më së shumti {1} shifra përpara pikës dhjetore.",
  "{0} must be at least {1}.": "Fusha “{0}” duhet të jetë të paktën {1}.",
  "{0} must be at most {1}.": "Fusha “{0}” duhet të jetë më së shumti {1}.",
  "{0} doesn't apply to this choice. Change the choice back and clear {1} first.": "Fusha “{0}” nuk vlen për këtë zgjedhje. Ktheni zgjedhjen dhe pastroni më parë fushën “{1}”.",
  "{0} must be a number, e.g. 1234.50.": "Fusha “{0}” duhet të jetë një numër, p.sh. 1234.50.",
  "{0} must be a number, e.g. 1234.": "Fusha “{0}” duhet të jetë një numër, p.sh. 1234.",
  "Changes weren't saved. Your entries are still here.": "Ndryshimet nuk u ruajtën. Të dhënat tuaja janë ende këtu.",
  "We couldn't confirm whether this saved. Check the record before trying again.": "Nuk mundëm të konfirmonim nëse u ruajt. Kontrolloni regjistrin para se të provoni përsëri.",
  "Your workspace changed in another tab, so nothing was saved. Your entries are still here.": "Hapësira juaj e punës ndryshoi në një skedë tjetër, ndaj asgjë nuk u ruajt. Të dhënat tuaja janë ende këtu.",
} satisfies Catalogue;
