/* LocumsLab — © 2026 LocumsLab. All rights reserved.
 * LocumsLab™ is a trademark of LocumsLab.
 */
// Extraction cache.
//
// The problem this solves is not model variance in the abstract. It is the one
// concrete case that destroys trust: the same person uploads the same contract
// twice and sees two different grades. LLM inference is not deterministic even
// with sampling parameters pinned, and this model rejects them outright, so no
// amount of prompt work makes a second run guaranteed to match the first.
//
// So don't run it twice. Hash the input, and if we have already analysed that
// exact document under the current rubric, prompt and model, return what we
// stored.
//
// SCOPE: cache entries are keyed per user. Two different people uploading the
// same agency template do NOT share an entry.
//
// The whole benefit lives in the same-user re-upload case, and sharing across
// users would mean one person's extraction — which contains verbatim quotes,
// agency and facility names lifted from their document — being served to
// someone else on a hash collision or a shared template. Not worth it for a
// cache hit, and it cuts against the 30-day-deletion promise.
//
// The key includes rubric, prompt and model version. Bump PROMPT_VERSION in
// extract-contract-background.js whenever the system prompt changes, or stale
// extractions will be served against new prompt semantics.

const crypto = require('crypto');
const text = require('./contract-text');

// Normalise before hashing so that trivial differences — a re-save that changes
// whitespace, a different line-ending convention — do not miss the cache.
// PDFs are hashed as raw bytes since we have no text for them server-side.
// Text is hashed through contract-text.js rather than a local whitespace
// collapse, so the same agreement hashes the same after a round trip that
// changes apostrophes, dashes or non-breaking spaces. pdf.js emits curly or
// straight quotes depending on the font encoding, so two extractions of one
// file could otherwise miss the cache.
//
// Scanned PDFs have no text layer and are hashed by their bytes. That still
// catches the case the cache exists for — the same person re-uploading the
// same file — it just won't match a re-export of the same document.
function contentHash(pdfBase64, contractText) {
  const h = crypto.createHash('sha256');
  if (typeof contractText === 'string' && contractText.trim().length) {
    h.update('text:');
    h.update(text.hashForm(text.normaliseContractText(contractText)));
  } else if (typeof pdfBase64 === 'string' && pdfBase64.length) {
    h.update('pdf:');
    h.update(pdfBase64);
  } else {
    return null;
  }
  return h.digest('hex');
}

function cacheKey(parts) {
  const raw = [
    parts.userId || 'anon',
    parts.contentHash,
    parts.profession,
    parts.rubricVersion,
    parts.promptVersion,
    parts.model
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// A miss, an error, an expired row — all return null and the caller extracts
// normally. The cache is an optimisation; it is never load-bearing.
async function lookup(db, key) {
  if (!key) return null;
  try {
    const { data, error } = await db
      .from('extraction_cache')
      .select('extracted, score, rubric_version')
      .eq('cache_key', key)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (error) {
      console.error('extraction_cache lookup failed:', error.message);
      return null;
    }
    return data || null;
  } catch (e) {
    console.error('extraction_cache lookup threw:', e && e.message);
    return null;
  }
}

// Fire and forget. A failed cache write must never fail a user's review.
async function store(db, key, payload) {
  if (!key) return;
  try {
    const { error } = await db.from('extraction_cache').upsert({
      cache_key: key,
      extracted: payload.extracted,
      score: payload.score,
      rubric_version: payload.rubricVersion,
      // Matches the 30-day review retention. A cache entry must not outlive
      // the review it came from, or a deleted contract's extraction would
      // still be recoverable by re-uploading the file.
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    }, { onConflict: 'cache_key' });
    if (error) console.error('extraction_cache write failed:', error.message);
  } catch (e) {
    console.error('extraction_cache write threw:', e && e.message);
  }
}

module.exports = { contentHash, cacheKey, lookup, store };
