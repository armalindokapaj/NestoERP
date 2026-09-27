/**
 * A saved link the picker no longer offers (AUD-09 §5, FV-10).
 *
 * Pickers list what may be chosen *now*: active suppliers, open requests,
 * unarchived projects. An existing record may still point at something that
 * has since dropped out of that list, and a `<select>` whose value is not among
 * its options shows — and submits — its first option instead, so an ordinary
 * edit quietly erased the link. The saved value is kept as one more option on
 * this record only, labelled as no longer available, so it survives a save
 * untouched and can still be changed deliberately. It is never offered on a
 * new record.
 */
export function withSavedOption<T extends { value: string; label: string }>(
  options: T[],
  saved: string | null | undefined,
  label = "Current value (no longer available for new records)",
  extra?: Omit<T, "value" | "label">,
): T[] {
  if (!saved || options.some((option) => option.value === saved)) return options;
  return [...options, { ...(extra ?? {}), value: saved, label } as T];
}
