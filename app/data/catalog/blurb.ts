// Book descriptions are the publisher's listing copy, not a synopsis: Google
// Books lifts them from the Play Books page, and Open Library's are often pasted
// from the jacket. The story is in there, but it comes wrapped in a sales banner
// ("#1 NEW YORK TIMES BESTSELLER •") and a run of press quotes ("“An intoxicating
// gem of a story.”—Marie Lu, New York Times bestselling author of …"), which is
// what the detail page opens on and what verifyPicksAgainstOverviews has to read
// past.
//
// Deliberately conservative: it removes only shapes that are unambiguously
// promotional, and hands back the original text when stripping would leave
// nothing. Free of the database and the network, so the rules are tested
// directly.

// Words that only ever appear in a sales banner. Matched case-insensitively, but
// a banner segment must also be short and end at a bullet or a line break, so a
// synopsis mentioning a prize isn't cut.
const BANNER_WORD =
  /\b(best-?sell(?:er|ing)|award|prize|finalist|winner|now a (?:major )?(?:motion picture|film|movie|netflix|series|hbo)|soon to be a|book club pick|editors?'? pick)\b/i

const BANNER_MAX_LENGTH = 160

// A quote, a dash, and who said it. The quote may use curly or straight marks;
// the dash may be an em, en, horizontal bar or a plain hyphen.
const PRESS_QUOTE = /(?:“[^”]{1,600}”|"[^"\n]{1,600}")\s*[—–―-]{1,2}\s*(?=[A-Z])/g

// Where an attribution ends: a line break, the next opening quote, or the end of
// a sentence. The sentence end needs two lowercase letters before the period so
// an initial ("J. K. Rowling") or an honorific ("Mr.") doesn't end it early.
const ATTRIBUTION_END = /\n|(?=[“"])|[a-z]{2}\.(?=\s|$)|$/
const ATTRIBUTION_MAX_LENGTH = 200

const PRAISE_HEADING = /^\s*(?:advance |early )?praise (?:for|from)\b[^\n]*$/gim

// A line on its own that ends in a full stop is a sentence, which a banner
// never is — "She wins the prize at the county fair." stays.
function isBanner(segment: string, terminator: string): boolean {
  if (segment.length > BANNER_MAX_LENGTH || !BANNER_WORD.test(segment)) return false
  return terminator !== '\n' || !/[.!?]$/.test(segment)
}

function stripBanner(text: string): string {
  let rest = text
  for (;;) {
    const match = rest.match(/^\s*([^\n•|]*)[•|\n]/)
    if (!match) return rest
    const segment = match[1].trim()
    const terminator = match[0].slice(-1)
    // An empty segment is a stray leading bullet — drop it and keep looking.
    if (segment && !isBanner(segment, terminator)) return rest
    rest = rest.slice(match[0].length)
  }
}

function stripPressQuotes(text: string): string {
  let out = ''
  let cursor = 0
  for (const match of text.matchAll(PRESS_QUOTE)) {
    const start = match.index
    // A match inside a stretch already removed.
    if (start < cursor) continue

    const afterDash = start + match[0].length
    const tail = text.slice(afterDash, afterDash + ATTRIBUTION_MAX_LENGTH + 1)
    const end = tail.match(ATTRIBUTION_END)
    if (!end || end.index === undefined || end.index > ATTRIBUTION_MAX_LENGTH) continue

    // The period belongs to the attribution; a line break or quote does not.
    const consumed = end[0].endsWith('.') ? end.index + end[0].length : end.index
    out += text.slice(cursor, start) + '\n\n'
    cursor = afterDash + consumed
  }
  return out + text.slice(cursor)
}

function tidy(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function stripPublisherPromo(raw: string): string {
  const original = tidy(raw)
  const stripped = tidy(stripPressQuotes(stripBanner(original)).replace(PRAISE_HEADING, ''))
  return stripped || original
}
