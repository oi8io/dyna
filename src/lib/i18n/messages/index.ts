import type { Locale } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n/dictionary";
import { en } from "@/lib/i18n/messages/en";
import { zhCN } from "@/lib/i18n/messages/zh-CN";

/**
 * Both dictionaries, keyed by locale.
 *
 * They are imported statically rather than loaded on demand: two languages of
 * UI copy is a few kilobytes, and a dynamic import would put an await in front
 * of every render for no measurable gain.
 */
export const MESSAGES: Record<Locale, Dictionary> = {
  "zh-CN": zhCN,
  en,
};
