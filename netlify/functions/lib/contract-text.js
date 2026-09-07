/* LocumsLab — © 2026 LocumsLab. All rights reserved.
 * LocumsLab™ is a trademark of LocumsLab.
 */
// Text normalisation, content hashing, and evidence validation.
//
// Three jobs, all deterministic, no model involved:
//
//   normaliseContractText()  one canonical form for the same contract, so the
//                            hash is stable across exports, and so quote
//                            matching is not defeated by a curly apostrophe.
//   contentHash()            SHA-256 of the normalised text. The cache key.
//   validateEvidence()       does the quote the model returned actually appear
//                            in the contract? If not, the field is not
//                            established and must not be scored.
//
// Why normalise before hashing: two PDFs of the identical contract differ in
// bytes because of metadata, producer strings and timestamps. Hashing the file
// would miss the case the cache exists for — the same person re-uploading the
// same agreement and expecting the same answer.

const crypto = require('crypto');

// Characters that survive a copy-paste through Word, a PDF export and a
// browser text layer as visually identical but differently encoded.
const CHAR_MAP = [
  [/[\u2018\u2019\u201A\u201B\u2032\u02BC]/g, "'"],   // curly and prime apostrophes
  [/[\u201C\u201D\u201E\u201F\u2033]/g, '"'],         // curly double quotes
  [/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, '-'],   // hyphens, en/em dashes
  [/[\u00A0\u2007\u202F\u2009\u200A]/g, ' '],         // non-breaking / thin spaces
  [/[\u200B\u200C\u200D\uFEFF]/g, ''],                // zero-width, BOM
  [/\u2026/g, '...']
];

function normaliseContractText(raw) {
  if (typeof raw !== 'string') return '';
  let t = raw.normalize('NFKC');
  CHAR_MAP.forEach(function (pair) { t = t.replace(pair[0], pair[1]); });
  return t
    .replace(/\r\n?/g, '\n')          // CRLF and lone CR
    .replace(/[ \t]+/g, ' ')          // runs of spaces and tabs
    .replace(/ *\n */g, '\n')         // trailing/leading space on each line
    .replace(/\n{3,}/g, '\n\n')       // more than one blank line
    .trim();
}

// Aggressive form used ONLY for quote matching, never for hashing or display.
// Drops line breaks and punctuation so a quote that spans a page break, or that
// the model reproduced with slightly different spacing, still matches.
function matchForm(s) {
  return normaliseContractText(s)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Line breaks are layout, not content: the same agreement exported twice wraps
// differently, and hashing the line structure would miss the cache on a file
// that is word-for-word identical. So the hash collapses ALL whitespace. The
// normalised text keeps its line breaks, because the model reads better with
// them and because quote matching spans them.
function hashForm(normalisedText) {
  return String(normalisedText || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function contentHash(normalisedText) {
  return crypto.createHash('sha256').update(hashForm(normalisedText), 'utf8').digest('hex');
}

// Below this, fuzzy head/tail matching is unsafe — six words of a long clause
// can coincide by accident. Short quotes are not skipped, they are held to a
// STRICTER standard: exact match or nothing.
//
// Contracts are full of short, highly verifiable evidence — "Net 30",
// "claims-made coverage", "thirty (30) days' notice", "at Contractor's
// expense". Skipping those would throw away the easiest verification in the
// document.
const MIN_WORDS_FOR_FUZZY = 6;

// One word proves nothing: "occurrence" appears in half the contract. Two is
// the floor at which a phrase is evidence rather than a keyword.
const MIN_WORDS_TO_VERIFY = 2;

function validateEvidence(quote, contractMatchForm) {
  if (!contractMatchForm) {
    return { checked: false, valid: true, reason: 'no source text to check against' };
  }
  if (typeof quote !== 'string' || !quote.trim()) {
    return { checked: false, valid: true, reason: 'no quote' };
  }

  const q = matchForm(quote);
  if (!q) return { checked: false, valid: true, reason: 'quote is punctuation only' };

  const words = q.split(' ');

  // Exact match settles it at any length.
  if (contractMatchForm.indexOf(q) !== -1) {
    return { checked: true, valid: true, reason: 'exact' };
  }

  if (words.length < MIN_WORDS_TO_VERIFY) {
    return { checked: false, valid: true, reason: 'quote too short to be evidence' };
  }

  // Short quote, no exact match. Fuzzy matching is not safe at this length, so
  // this is a genuine failure rather than an unverifiable case.
  if (words.length < MIN_WORDS_FOR_FUZZY) {
    return { checked: true, valid: false, reason: 'short quote not found verbatim' };
  }

  // The model sometimes elides the middle of a long clause, or joins text
  // across a page break. Accept when a long head AND tail both appear in order.
  if (words.length >= 12) {
    const head = words.slice(0, 6).join(' ');
    const tail = words.slice(-6).join(' ');
    const hi = contractMatchForm.indexOf(head);
    if (hi !== -1) {
      const ti = contractMatchForm.indexOf(tail, hi);
      // Within a reasonable span, so head and tail are one passage rather than
      // two coincidences pages apart.
      if (ti !== -1 && (ti - hi) < q.length * 3) {
        return { checked: true, valid: true, reason: 'head and tail matched' };
      }
    }
  }

  return { checked: true, valid: false, reason: 'quote not found in contract' };
}

// Walks an extracted object and marks every field whose quote cannot be found.
// Returns the fields it rejected so the caller can decide what to do with them
// — this function never mutates and never scores.
// sourceType is recorded so a scan is never mistaken for a clean bill of
// health. No text layer means validation was UNAVAILABLE, not that the
// evidence passed.
function auditEvidence(extracted, normalisedText, sourceType) {
  const src = normalisedText ? matchForm(normalisedText) : '';
  const rejected = [];
  const checked = [];

  Object.keys(extracted || {}).forEach(function (key) {
    const f = extracted[key];
    if (!f || typeof f !== 'object' || Array.isArray(f)) return;
    if (f.value === null || f.value === undefined || f.value === '') return;

    const r = validateEvidence(f.quote, src);
    if (r.checked) checked.push(key);
    if (r.checked && !r.valid) rejected.push({ key: key, value: f.value, quote: f.quote });
  });

  return {
    rejected: rejected,
    checkedCount: checked.length,
    validationAvailable: !!src,
    sourceType: sourceType || (src ? 'text' : 'unavailable'),
    status: src ? 'validated' : 'unavailable'
  };
}

module.exports = {
  normaliseContractText,
  matchForm,
  hashForm,
  contentHash,
  validateEvidence,
  auditEvidence
};
