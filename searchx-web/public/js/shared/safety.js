// Hard safety rail shared by the Worker and the app: SearchX never searches for or shows
// content that sexualizes minors. Queries matching these rules are refused and matching
// results are dropped. This cannot be turned off.
//
// Drawn content (hentai, Rule34, 3D) gets stricter rules: drawn characters have no verified age,
// and in that genre school settings mean the character is a minor. Those rules apply to Rule34
// always, to everything in hentai mode, and to any query or result that looks drawn.

const BLOCKED_TOKENS = new Set([
  'child', 'children', 'childs', 'kid', 'kids', 'kiddie', 'kiddy', 'underage', 'underaged', 'minor', 'minors',
  'preteen', 'preteens', 'pre-teen', 'loli', 'lolis', 'lolicon', 'shota', 'shotacon', 'shotas', 'toddler',
  'toddlers', 'infant', 'infants', 'jailbait', 'pedo', 'pedophile', 'paedo', 'cp', 'cub', 'cubs',
  'elementary', 'middleschool', 'prepubescent', 'tween', 'tweens', 'youngling',
  // French
  'enfant', 'enfants', 'mineur', 'mineure', 'mineurs', 'mineures', 'gamin', 'gamine', 'gamins', 'fillette',
  'fillettes', 'collegien', 'collegienne', 'pedophilie', 'pedopornographie'
]);

const BLOCKED_PHRASES = [
  'under age', 'under 18', 'middle school', 'grade school', 'little girl', 'little boy', 'young girl',
  'young boy', 'school age', 'petite fille', 'petit garcon'
];

// Extra rules for drawn content.
const DRAWN_BLOCKED_TOKENS = new Set([
  'schoolgirl', 'schoolgirls', 'schoolboy', 'schoolboys', 'highschooler', 'highschoolers', 'highschool',
  'middleschooler', 'gradeschooler', 'kindergarten', 'kindergartener', 'randoseru', 'jk', 'jc', 'js',
  'joshikousei', 'joshikosei', 'joshikouse', 'younger',
  // French
  'ecoliere', 'ecolieres', 'ecolier', 'ecoliers', 'lyceenne', 'lyceennes', 'lyceen', 'lyceens',
  'collegiens', 'collegiennes'
]);

const DRAWN_BLOCKED_PHRASES = [
  'high school', 'school girl', 'school boy', 'aged down', 'age regression', 'age play', 'grade schooler',
  'middle schooler', 'elementary school', 'kinder garten'
];

/** Tags that denote minors on booru-style sites (Rule34); always excluded from those searches. */
export const BOORU_NEGATIVE_TAGS = ['loli', 'shota', 'child', 'young', 'toddler', 'cub', 'underage', 'aged_down', 'younger'];

// Ages 1–17 written as "12yo", "15 y/o", "16 years old", "aged 14", "14 ans".
const AGE_PATTERNS = [
  /\b(?:[1-9]|1[0-7])\s*(?:yo|y\/o|yrs?|years?[\s-]*old|ans)\b/,
  /\baged?\s*(?:[1-9]|1[0-7])\b/
];

// Words that mark drawn / animated content.
const DRAWN_HINT = /\b(?:hentai|anime|animated|animation|cartoon|toon|3d|3dcg|sfm|mmd|koikatsu|rule ?34|r34|ecchi|doujin|doujinshi|manga|futanari|futa|waifu|eroge)\b/;

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/_/g, ' ');
}

/** True when a query, title or tag looks like it is about drawn / animated content. */
export function looksDrawn(text) {
  return DRAWN_HINT.test(normalize(text));
}

/**
 * True when the text asks for or describes minors. `drawn` adds the drawn-content rules
 * (school-age terms, age regression…).
 */
export function isBlockedText(text, drawn = false) {
  const n = normalize(text);
  if (!n) return false;
  for (const tok of n.split(/[^a-z0-9-]+/)) {
    if (!tok) continue;
    // "pre-teen" as a whole, and each part of hyphenated words ("onee-shota").
    for (const part of tok.includes('-') ? [tok, ...tok.split('-')] : [tok]) {
      if (BLOCKED_TOKENS.has(part)) return true;
      if (drawn && DRAWN_BLOCKED_TOKENS.has(part)) return true;
    }
  }
  if (BLOCKED_PHRASES.some(p => n.includes(p))) return true;
  if (drawn && DRAWN_BLOCKED_PHRASES.some(p => n.includes(p))) return true;
  return AGE_PATTERNS.some(re => re.test(n));
}

/** Booru tag check: the drawn rules plus any tag built on loli/shota ("oppai_loli", "loli_focus"). */
export function isBlockedTag(tag) {
  const t = String(tag || '').toLowerCase();
  if (!t) return false;
  if (BOORU_NEGATIVE_TAGS.includes(t) || t.split(/[_\s-]+/).some(part => /loli|shota/.test(part))) return true;
  return isBlockedText(t, true);
}

export function isQueryAllowed(q, { drawn = false } = {}) {
  return !isBlockedText(q, drawn || looksDrawn(q));
}

export function isItemAllowed(item, { drawn = false } = {}) {
  if (!item) return false;
  const tags = (item.tags || []).map(t => String(t).toLowerCase());
  const isDrawn = drawn || item.src === 'rule34' || looksDrawn(item.title) || tags.some(looksDrawn);
  if (isBlockedText(item.title, isDrawn)) return false;
  if (isDrawn) return !tags.some(isBlockedTag);
  return !tags.some(t => isBlockedText(t));
}
