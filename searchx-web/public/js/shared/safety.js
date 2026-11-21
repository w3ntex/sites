// Hard safety rail shared by the Worker and the app: SearchX never searches for or shows
// content that sexualizes minors. Queries matching these rules are refused and matching
// results are dropped. This cannot be turned off.

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

/** Tags that denote minors on booru-style sites (Rule34); always excluded from those searches. */
export const BOORU_NEGATIVE_TAGS = ['loli', 'shota', 'child', 'young', 'toddler', 'cub', 'underage'];

// Ages 1–17 written as "12yo", "15 y/o", "16 years old", "aged 14", "14 ans".
const AGE_PATTERNS = [
  /\b(?:[1-9]|1[0-7])\s*(?:yo|y\/o|yrs?|years?[\s-]*old|ans)\b/,
  /\baged?\s*(?:[1-9]|1[0-7])\b/
];

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/_/g, ' ');
}

export function isBlockedText(text) {
  const n = normalize(text);
  if (!n) return false;
  for (const tok of n.split(/[^a-z0-9-]+/)) {
    if (tok && BLOCKED_TOKENS.has(tok)) return true;
  }
  if (BLOCKED_PHRASES.some(p => n.includes(p))) return true;
  return AGE_PATTERNS.some(re => re.test(n));
}

export function isQueryAllowed(q) {
  return !isBlockedText(q);
}

export function isItemAllowed(item) {
  if (!item) return false;
  if (isBlockedText(item.title)) return false;
  const tags = (item.tags || []).map(t => String(t).toLowerCase());
  if (item.src === 'rule34' && tags.some(t => BOORU_NEGATIVE_TAGS.includes(t))) return false;
  return !tags.some(isBlockedText);
}
