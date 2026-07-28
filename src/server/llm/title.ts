import { type Locale, detectContentLocale } from "@/lib/i18n/config";

/**
 * Turns a request into something that reads like a name.
 *
 * A title is what appears in the sidebar, the gallery card and the browser tab.
 * Using the request verbatim put a whole sentence there — "做一个蜘蛛纸牌，要有
 * 拖拽和难度选择", or "make me a spider solitaire with drag and drop" — when the
 * name is the two words inside it.
 *
 * The model is asked for a proper name during planning; this is the layer that
 * holds the line when it answers with a phrase anyway, and it also produces the
 * placeholder shown between creating a project and the plan coming back.
 *
 * Both languages are handled in a single pass rather than behind a locale
 * switch. The caller frequently has no locale to offer — the model's answer
 * arrives on its own — and a request like "做一个 roguelike" is not cleanly
 * either one.
 */

/** Chinese is dense enough that 20 characters is a full name and then some. */
const MAX_TITLE_CHARS = 20;
/** The same name in English needs the room that alphabet takes. */
const MAX_TITLE_CHARS_LATIN = 40;

/**
 * Openers that describe the act of asking, not the thing being asked for.
 *
 * Longest form first within each family: alternation takes the first match, so
 * listing `做` before `做一个` strips the verb and leaves the quantifier behind.
 */
const LEADING_NOISE =
  /^(?:请|帮我|给我|我想要|我想|我要|需要|来|做一个|做个|做|生成一个|生成个|生成|创建一个|创建|开发一个|开发|写一个|写|设计一个|设计|制作一个|制作|搞一个|搞个|搞)+/;

/** Left over once the verb goes: "一个蜘蛛纸牌". */
const LEADING_QUANTIFIER = /^(?:一个|一款|一份|一只|个|款)+/;

/**
 * The same openers in English.
 *
 * Word boundaries matter here in a way they do not in Chinese: without `\b`,
 * "makeshift" would lose its opening verb and "Anagram" its article.
 */
const LEADING_NOISE_EN =
  /^(?:please|can you|could you|i'd (?:like|want)|i would (?:like|want)|i want(?: to (?:play|make|build|have))?|i need|let's|lets|help me|give me|make me|build me|make|build|create|generate|write|design|develop|code)\b[\s,:-]*/i;

/** Left over once the verb goes: "a spider solitaire". */
const LEADING_ARTICLE_EN = /^(?:a|an|the|some|one)\b[\s,:-]*/i;

const WRAPPING_QUOTES = /^[「『《【"'“”‘’\[(]+|[」』》】"'“”‘’\])]+$/g;

/** Where a name ends and elaboration begins. */
const CLAUSE_BREAK = /[，,。.！!？?；;：:、\n\r]/;

/** Fallbacks are copy, so they follow the language the request was in. */
const FALLBACKS: Record<Locale, string> = {
  "zh-CN": "未命名作品",
  en: "Untitled",
};

/**
 * Strips openers until none are left.
 *
 * One pass is not enough for English, where "please make me a" is four separate
 * layers. The loop ends as soon as a pass changes nothing, so it terminates
 * whether or not the cap is reached.
 */
function stripOpeners(input: string, patterns: RegExp[]): string {
  let title = input;
  for (let pass = 0; pass < 6; pass += 1) {
    const before = title;
    for (const pattern of patterns) {
      title = title.replace(pattern, "").trim();
    }
    if (title === before) break;
  }
  return title;
}

export function normalizeTitle(raw: string, fallback?: string): string {
  // Split before collapsing whitespace: a newline is a clause break, and
  // turning it into a space first would hide it.
  const [firstClause] = raw.split(CLAUSE_BREAK);
  let title = (firstClause ?? raw).replace(/\s+/g, " ").trim();

  title = title.replace(WRAPPING_QUOTES, "").trim();
  title = stripOpeners(title, [
    LEADING_NOISE,
    LEADING_QUANTIFIER,
    LEADING_NOISE_EN,
    LEADING_ARTICLE_EN,
  ]);
  // Stripping the opener can expose a quote: 做一个「蜘蛛纸牌」
  title = title.replace(WRAPPING_QUOTES, "").trim();

  // Judged on what survived, so an English name pulled out of a Chinese
  // sentence is measured as English.
  const locale = detectContentLocale(title || raw);
  const limit = locale === "en" ? MAX_TITLE_CHARS_LATIN : MAX_TITLE_CHARS;
  if (title.length > limit) {
    title = title.slice(0, limit).trim();
    // Cutting mid-word reads as a typo, so an English title backs up to the
    // last space — unless doing so would leave barely any name at all.
    if (locale === "en") {
      const lastSpace = title.lastIndexOf(" ");
      if (lastSpace > limit / 2) title = title.slice(0, lastSpace).trim();
    }
  }

  return title || fallback || FALLBACKS[locale];
}
