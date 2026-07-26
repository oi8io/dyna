/**
 * Turns a request into something that reads like a name.
 *
 * A title is what appears in the sidebar, the gallery card and the browser tab.
 * Using the request verbatim put a whole sentence there — "做一个蜘蛛纸牌，要有
 * 拖拽和难度选择" — when the name is the two words inside it.
 *
 * The model is asked for a proper name during planning; this is the layer that
 * holds the line when it answers with a phrase anyway, and it also produces the
 * placeholder shown between creating a project and the plan coming back.
 */

const MAX_TITLE_CHARS = 20;

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

const WRAPPING_QUOTES = /^[「『《【"'“”‘’\[(]+|[」』》】"'“”‘’\])]+$/g;

/** Where a name ends and elaboration begins. */
const CLAUSE_BREAK = /[，,。.！!？?；;：:、\n\r]/;

export function normalizeTitle(raw: string, fallback = "未命名作品"): string {
  // Split before collapsing whitespace: a newline is a clause break, and
  // turning it into a space first would hide it.
  const [firstClause] = raw.split(CLAUSE_BREAK);
  let title = (firstClause ?? raw).replace(/\s+/g, " ").trim();

  title = title.replace(WRAPPING_QUOTES, "").trim();
  title = title.replace(LEADING_NOISE, "").trim();
  title = title.replace(LEADING_QUANTIFIER, "").trim();
  // Stripping the opener can expose a quote: 做一个「蜘蛛纸牌」
  title = title.replace(WRAPPING_QUOTES, "").trim();

  if (title.length > MAX_TITLE_CHARS) {
    title = title.slice(0, MAX_TITLE_CHARS).trim();
  }

  return title || fallback;
}
