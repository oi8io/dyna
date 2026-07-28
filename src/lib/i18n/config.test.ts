import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCALE,
  LOCALES,
  detectContentLocale,
  isLocale,
  negotiateLocale,
} from "@/lib/i18n/config";
import { translateError } from "@/lib/i18n/dictionary";
import { MESSAGES } from "@/lib/i18n/messages";
import { isSeedPrompt, seedsFor } from "@/lib/i18n/seeds";

describe("negotiateLocale", () => {
  it("matches a language regardless of its region", () => {
    expect(negotiateLocale("zh-TW")).toBe("zh-CN");
    expect(negotiateLocale("zh-Hant-HK")).toBe("zh-CN");
    expect(negotiateLocale("en-GB")).toBe("en");
  });

  it("respects quality ranking rather than document order", () => {
    expect(negotiateLocale("fr;q=1.0, en;q=0.9, zh;q=0.8")).toBe("en");
    expect(negotiateLocale("en;q=0.5, zh;q=0.9")).toBe("zh-CN");
  });

  it("ignores a language that was explicitly refused", () => {
    expect(negotiateLocale("en;q=0, zh")).toBe("zh-CN");
  });

  it("falls back when nothing on offer is understood", () => {
    expect(negotiateLocale(null)).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale("")).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale("fr-CA, de")).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale("*")).toBe(DEFAULT_LOCALE);
  });

  it("rejects a cookie value that is not a locale we ship", () => {
    expect(isLocale("zh-CN")).toBe(true);
    expect(isLocale("zh")).toBe(false);
    expect(isLocale("../../etc/passwd")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});

/**
 * Generated games follow what the user typed, not the interface language, so
 * this is the function that decides what language a game comes out in.
 */
describe("detectContentLocale", () => {
  it("reads a plain request in either language", () => {
    expect(detectContentLocale("做一个霓虹打砖块")).toBe("zh-CN");
    expect(detectContentLocale("a neon breakout game")).toBe("en");
  });

  it("treats a Chinese sentence with an English term as Chinese", () => {
    expect(detectContentLocale("做一个 roguelike")).toBe("zh-CN");
    expect(detectContentLocale("生成一个 2048，但数字是行星")).toBe("zh-CN");
  });

  it("treats an English sentence with a stray character as English", () => {
    expect(
      detectContentLocale("a puzzle game about the 汉 dynasty with 30 levels"),
    ).toBe("en");
  });

  it("falls back when there is nothing to go on", () => {
    expect(detectContentLocale("")).toBe(DEFAULT_LOCALE);
    expect(detectContentLocale("2048")).toBe(DEFAULT_LOCALE);
  });
});

describe("dictionaries", () => {
  it("ships every locale it claims to", () => {
    for (const locale of LOCALES) expect(MESSAGES[locale]).toBeDefined();
  });

  /**
   * The English dictionary is annotated with the reference type, so a missing
   * key is already a compile error. This catches the other half: a key that is
   * present but was never translated.
   */
  it("has no English entry left as the Chinese original", () => {
    const zh = MESSAGES["zh-CN"].errors as Record<string, string>;
    const en = MESSAGES.en.errors as Record<string, string>;
    for (const [key, value] of Object.entries(zh)) {
      expect(en[key], `errors.${key}`).not.toBe(value);
    }
  });

  it("falls back rather than rendering an empty box for an unknown code", () => {
    const t = MESSAGES.en;
    expect(translateError(t, "remix_failed")).toBe(t.errors.remix_failed);
    expect(translateError(t, "code_from_a_newer_server")).toBe(t.errors.unknown);
    expect(translateError(t, undefined)).toBe(t.errors.unknown);
  });

  /**
   * Failures written before codes existed stored a whole Chinese sentence in
   * `content`, and the builder passes that through this same function.
   */
  it("does not crash on a legacy prose message", () => {
    expect(translateError(MESSAGES.en, "生成失败，请稍后重试。")).toBe(
      MESSAGES.en.errors.unknown,
    );
  });
});

/**
 * A prompt field pre-filled with an example has to follow a language switch,
 * because the field's value outlives the server re-render that the switch
 * triggers. It must not follow one once the user has written something.
 */
describe("isSeedPrompt", () => {
  it("recognises an example from either locale and either section", () => {
    for (const locale of LOCALES) {
      for (const section of ["home", "newProject"] as const) {
        for (const seed of seedsFor(locale, section)) {
          expect(isSeedPrompt(seed), seed).toBe(true);
        }
      }
    }
  });

  it("recognises one that survived a round trip through the URL", () => {
    // The home page posts its seed to /builder/new as ?prompt=…, so it reaches
    // the builder trimmed but otherwise intact.
    const carried = ` ${seedsFor("en", "home")[0]} `;
    expect(isSeedPrompt(carried)).toBe(true);
  });

  it("leaves anything the user actually wrote alone", () => {
    expect(isSeedPrompt("做一个我自己想出来的游戏")).toBe(false);
    expect(isSeedPrompt("a game I thought of myself")).toBe(false);
    // A seed the user edited is theirs now.
    expect(isSeedPrompt(`${seedsFor("en", "home")[0]} but harder`)).toBe(false);
  });

  it("treats an empty field as still seedable", () => {
    expect(isSeedPrompt("")).toBe(true);
    expect(isSeedPrompt("   ")).toBe(true);
  });

  /**
   * If the two locales shared a seed, switching language would leave the field
   * unchanged and the bug this guards against would be invisible.
   */
  it("gives each locale distinct seeds", () => {
    for (const section of ["home", "newProject"] as const) {
      const zh = seedsFor("zh-CN", section);
      const en = seedsFor("en", section);
      expect(zh.length).toBe(en.length);
      expect(zh.filter((seed) => en.includes(seed))).toEqual([]);
    }
  });
});
