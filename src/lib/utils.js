import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind classes with conditional logic (shadcn convention). */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
