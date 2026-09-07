/* LocumsLab — © 2026 LocumsLab. All rights reserved.
 * LocumsLab™ is a trademark of LocumsLab.
 */
// Cache for the prose contract review.
//
// Sibling of extraction-cache.js, deliberately a separate table and a separate
// key: the two are written by different functions, invalidate on different
// versions, and one must never block the other. The extraction cache turns on
// the rubric and prompt version; this one turns on the analyzer version.
//
// Same rules as its sibling: a miss, an error or an expired row all return null
// and the caller proceeds normally. The cache is an optimisation and is never
// load-bearing.

const crypto = require('crypto');
const text = require('./contract-text');

// Hashed from the normalised TEXT where there is any, so a re-export of the
// same agreement still hits. A scan with no text layer falls back to the file
// bytes, which still catches the same person re-uploading the same file.
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
  if (!parts || !parts.contentHash) return null;
  const raw = [
    parts.userId || 'anon',
    parts.contentHash,
    parts.contractType,
    parts.analyzerVersion,
    parts.model
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function lookup(db, key) {
  if (!key) return null;
  try {
    const { data, error } = await db
      .from('analysis_cache')
      .select('analysis, analyzer_version')
      .eq('cache_key', key)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (error) {
      console.error('analysis_cache lookup failed:', error.message);
      return null;
    }
    return data || null;
  } catch (e) {
    console.error('analysis_cache lookup threw:', e && e.message);
    return null;
  }
}

async function store(db, key, payload) {
  if (!key || !payload || !payload.analysis) return;
  try {
    const { error } = await db.from('analysis_cache').upsert({
      cache_key: key,
      analysis: payload.analysis,
      analyzer_version: String(payload.analyzerVersion),
      // Matches the 30-day review retention. A cache entry must not outlive the
      // review it came from.
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    }, { onConflict: 'cache_key' });
    if (error) console.error('analysis_cache write failed:', error.message);
  } catch (e) {
    console.error('analysis_cache write threw:', e && e.message);
  }
}

module.exports = { contentHash, cacheKey, lookup, store };
