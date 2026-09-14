import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge only knows Tailwind's stock sizes, so it read the design
 * system's type scale (`text-micro`, `text-page`, …) as text colours and
 * dropped the size whenever a colour followed it. Registering the scale keeps
 * size and colour in their own groups.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["hero", "display", "page", "section", "card", "body", "table", "meta", "micro"],
    },
  },
});

/** Merge conditional class names, with later Tailwind utilities winning. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
