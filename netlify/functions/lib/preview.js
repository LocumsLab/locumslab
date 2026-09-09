/* LocumsLab — © 2026 LocumsLab. All rights reserved.
 * LocumsLab™ is a trademark of LocumsLab.
 */
// Free preview: entitlement, quota, and redaction.
//
// The paywall is enforced HERE, server-side, not in the browser. The full
// analysis is written to contract_reviews and RLS lets a user read their own
// row, so anything the UI merely blurs is one devtools call away from being
// free. A free user's row must therefore never contain the full review.
//
// The full result is still computed and cached. On upgrade the same contract
// re-runs, hits the cache, and returns everything in under a second with no
// second API call.

const PREVIEW_LIMIT = 3;

// Authoritative Pro check. Never trust a flag from the client.
async function isPro(db, userId) {
  if (!userId) return false;
  try {
    const { data, error } = await db
      .from('entitlements')
      .select('plan, status')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) { console.error('entitlement check failed:', error.message); return false; }
    return !!(data && data.plan === 'pro' && data.status === 'active');
  } catch (e) {
    console.error('entitlement check threw:', e && e.message);
    // Fail CLOSED. An entitlement lookup that errors must not hand out the
    // full product.
    return false;
  }
}

// How many previews this user has already spent. Counted from the reviews
// themselves rather than a counter column, so it cannot drift and it is
// auditable after the fact.
async function previewsUsed(db, userId) {
  if (!userId) return PREVIEW_LIMIT;
  try {
    const { count, error } = await db
      .from('contract_reviews')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('access_tier', 'preview');
    if (error) { console.error('preview count failed:', error.message); return PREVIEW_LIMIT; }
    return count || 0;
  } catch (e) {
    console.error('preview count threw:', e && e.message);
    return PREVIEW_LIMIT; // fail closed
  }
}

async function accessFor(db, userId) {
  if (await isPro(db, userId)) {
    return { tier: 'full', pro: true, used: 0, limit: PREVIEW_LIMIT, remaining: null };
  }
  const used = await previewsUsed(db, userId);
  return {
    tier: 'preview',
    pro: false,
    used: used,
    limit: PREVIEW_LIMIT,
    remaining: Math.max(0, PREVIEW_LIMIT - used),
    exhausted: used >= PREVIEW_LIMIT
  };
}

const SEVERITY_RANK = { High: 0, Medium: 1, Low: 2 };

// A figure computed from THIS contract's own numbers — "$1,584", "$4,000" —
// beats a category range like "$5,000 to $15,000". The first proves the review
// read their document; the second is something they could have googled.
//
// Heuristics, and they are only heuristics: a lone dollar amount is more likely
// derived than a pair separated by "to" or an en dash, and a figure with no
// round-number zeros is more likely calculated than quoted. This decides which
// of several findings to show first, never what the findings say, so a wrong
// guess costs a slightly weaker hook and nothing else.
const MONEY = /\$[\d,]+(?:\.\d{2})?/g;
const RANGE = /\$[\d,]+(?:\.\d{2})?\s*(?:to|–|—|-)\s*\$?[\d,]+/i;

function specificityOf(issue) {
  if (!issue || typeof issue !== 'object') return 0;
  const textOf = [issue.detail, issue.title, issue.fix, issue.impact]
    .filter(function (x) { return typeof x === 'string'; }).join(' ');
  if (!textOf) return 0;

  const figures = textOf.match(MONEY) || [];
  if (!figures.length) return 0;

  // A stated range reads as a national ballpark, not this contract.
  if (RANGE.test(textOf)) return 1;

  // A figure that is not a round thousand is very unlikely to be a quoted
  // benchmark: $1,584 was calculated, $5,000 probably was not.
  const derived = figures.some(function (f) {
    const n = Number(f.replace(/[$,]/g, ''));
    return isFinite(n) && n > 0 && (n % 500 !== 0);
  });
  return derived ? 3 : 2;
}

// Highest severity wins outright — a preview must never lead with a lesser
// finding because it happened to carry a number. Within the top severity band,
// the most specific one leads.
function pickPreviewIssue(issues) {
  if (!issues.length) return { shown: [], hidden: [] };
  const topSeverity = issues.reduce(function (best, i) {
    const r = SEVERITY_RANK[i && i.severity];
    return Math.min(best, r === undefined ? 3 : r);
  }, 3);

  let bestIndex = 0, bestScore = -1;
  issues.forEach(function (i, idx) {
    const r = SEVERITY_RANK[i && i.severity];
    if ((r === undefined ? 3 : r) !== topSeverity) return;
    const sc = specificityOf(i);
    if (sc > bestScore) { bestScore = sc; bestIndex = idx; }
  });

  const shown = [issues[bestIndex]];
  const hidden = issues.filter(function (_, idx) { return idx !== bestIndex; });
  return { shown: shown, hidden: hidden };
}

// One complete finding, then titles only.
//
// The single full issue is the whole point. A blur says "something is here";
// a real finding with the contract's own language and a specific ask proves the
// review is worth paying for. The highest-severity issue is chosen because it
// is the one they most need and the one they are least likely to have spotted.
function redactAnalysis(analysis) {
  if (!analysis || typeof analysis !== 'object') return analysis;

  const issues = Array.isArray(analysis.issues) ? analysis.issues.slice() : [];
  issues.sort(function (a, b) {
    const ra = SEVERITY_RANK[a && a.severity]; const rb = SEVERITY_RANK[b && b.severity];
    return (ra === undefined ? 3 : ra) - (rb === undefined ? 3 : rb);
  });

  const picked = pickPreviewIssue(issues);
  const shown = picked.shown;
  const hidden = picked.hidden;

  const missing = Array.isArray(analysis.missingItems) ? analysis.missingItems : [];
  const questions = Array.isArray(analysis.recruiterQuestions) ? analysis.recruiterQuestions : [];
  const attorney = Array.isArray(analysis.attorneyItems) ? analysis.attorneyItems : [];

  return {
    preview: true,
    riskLevel: analysis.riskLevel,
    summary: analysis.summary,
    severityBuckets: analysis.severityBuckets,

    issues: shown,
    // Titles only. Enough to show the review found real, specific things —
    // not enough to act on without the detail and the ask.
    lockedIssueTitles: hidden.map(function (i) {
      return { title: (i && i.title) || 'Contract provision', severity: i && i.severity };
    }),

    // Counts, not contents.
    locked: {
      issues: hidden.length,
      highSeverity: issues.filter(function (i) { return i && i.severity === 'High'; }).length,
      missingItems: missing.length,
      recruiterQuestions: questions.length,
      attorneyItems: attorney.length
    },

    missingTerms: [],
    missingItems: [],
    recruiterQuestions: [],
    takeToAttorney: [],
    attorneyItems: []
  };
}

// The grade survives; the negotiation playbook does not. Knowing the contract
// is a D is the hook. Knowing which three things to ask for, in what order,
// with fallback positions, is the product.
function redactScore(score) {
  if (!score || typeof score !== 'object') return score;

  const priorities = Array.isArray(score.priorities) ? score.priorities : [];

  return {
    preview: true,
    rubricVersion: score.rubricVersion,
    profession: score.profession,
    overall: score.overall,
    level: score.level,
    rate: score.rate,
    categories: score.categories,
    evidence: score.evidence,
    reverification: score.reverification,

    // One ask, complete. The rest by name only.
    priorities: priorities.slice(0, 1),
    lockedPriorityTitles: priorities.slice(1).map(function (p) {
      return { label: p.label, priority: p.priority };
    }),

    locked: {
      priorities: Math.max(0, priorities.length - 1),
      clarifications: (score.clarifications || []).length,
      strengths: (score.strengths || []).length,
      unresolved: (score.unresolved || []).length
    },

    clarifications: [],
    strengths: [],
    unresolved: [],
    notWorthFighting: [],
    fields: []
  };
}

module.exports = { PREVIEW_LIMIT, isPro, previewsUsed, accessFor, redactAnalysis, redactScore,
                   pickPreviewIssue, specificityOf };
