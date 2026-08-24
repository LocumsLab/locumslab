/* LocumsLab — © 2026 LocumsLab. All rights reserved.
 * LocumsLab™ is a trademark of LocumsLab.
 * This file, including the rubric weights, field definitions and explanatory copy,
 * is proprietary. Not licensed for reuse or redistribution.
 */
// Deterministic contract scoring. No API calls, no randomness.
// Same extracted input always produces the same grade, which is the whole
// point of splitting this out of the model call.
//
//   const { scoreContract } = require('./score-contract');
//   const score = scoreContract(extracted, rubric);
//
// `extracted` is the JSON the extraction call returns: every key maps to
// { value, quote }. A value of null means the contract does not address it.

const TIER_ORDER = { heavy: 0, moderate: 1, light: 2 };

function readField(extracted, key) {
  const raw = extracted && extracted[key];
  if (raw === undefined || raw === null) return { value: null, quote: '' };
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return {
      value: raw.value === undefined ? null : raw.value,
      quote: typeof raw.quote === 'string' ? raw.quote : ''
    };
  }
  // Tolerate a bare value if the model skipped the wrapper.
  return { value: raw, quote: '' };
}

function num(v) {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Number(v);
  return null;
}

// Numeric fields accept the sentinel "none", meaning the contract explicitly
// states there is no such term. That is a real term and scores at the floor,
// unlike silence, which is not scored at all.
function isExplicitNone(v) {
  return typeof v === 'string' && v.trim().toLowerCase() === 'none';
}

function scoreNumberField(spec, value) {
  const bands = spec.bands || [];
  if (isExplicitNone(value)) {
    const last = bands[bands.length - 1] || { points: 0, label: 'Not provided' };
    return { points: 0, band: last.label };
  }
  const n = num(value);
  if (n === null) return null;
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    if (b.gte !== undefined) {
      if (b.gte === null || n >= b.gte) return { points: b.points, band: b.label };
    } else if (b.lte !== undefined) {
      if (b.lte === null || n <= b.lte) return { points: b.points, band: b.label };
    }
  }
  return { points: 0, band: 'Unclassified' };
}

function scoreEnumField(spec, value) {
  if (value === null || value === undefined) return null;
  const key = typeof value === 'boolean' ? String(value) : String(value).trim().toLowerCase();
  const table = spec.points || {};
  if (!Object.prototype.hasOwnProperty.call(table, key)) return null;
  return { points: table[key], band: key.replace(/_/g, ' ') };
}

// ---- derived fields -------------------------------------------------------
// These read more than one extracted key, so they cannot live in the JSON.
// Each returns null when there is not enough stated information to score,
// which routes the field to clarifications.

const DERIVATIONS = {
  overtime: function (spec, extracted) {
    const threshold = num(readField(extracted, 'overtime_threshold_hours').value);
    const multRaw = readField(extracted, 'overtime_multiplier').value;
    const mult = num(multRaw);

    if (threshold === null && mult === null) return null;

    // A stated threshold with no premium is a real, unfavorable term.
    if (threshold !== null && mult === null && !isExplicitNone(multRaw)) return null;

    let points = 0;
    let band;
    const m = isExplicitNone(multRaw) ? 1 : (mult || 1);

    if (m >= 1.5 && threshold !== null && threshold <= 40) {
      points = spec.possible;
      band = 'Defined threshold at 1.5x or better';
    } else if (m >= 1.5) {
      points = Math.round(spec.possible * 0.7);
      band = '1.5x premium, threshold unclear';
    } else if (m > 1 && threshold !== null) {
      points = Math.round(spec.possible * 0.5);
      band = 'Defined threshold below 1.5x';
    } else if (threshold !== null) {
      points = Math.round(spec.possible * 0.2);
      band = 'Threshold defined, paid at straight time';
    } else {
      points = 0;
      band = 'No premium and no threshold';
    }
    return { points: points, band: band };
  },

  termination_asymmetry: function (spec, extracted) {
    const agency = num(readField(extracted, 'termination_notice_agency_days').value);
    const crna = num(readField(extracted, 'termination_notice_crna_days').value);
    if (agency === null || crna === null) return null;

    const gap = crna - agency; // positive means you owe more notice than they do
    if (gap <= 0) return { points: spec.possible, band: 'Symmetric or favorable to you' };
    if (gap <= 7) return { points: Math.round(spec.possible * 0.6), band: 'Slightly asymmetric' };
    if (gap <= 21) return { points: Math.round(spec.possible * 0.2), band: 'Materially asymmetric' };
    return { points: 0, band: 'Heavily asymmetric' };
  },

  non_compete: function (spec, extracted) {
    const present = readField(extracted, 'non_compete_present').value;
    if (present === null || present === undefined) return null;
    if (present === false || String(present).toLowerCase() === 'false') {
      return { points: spec.possible, band: 'No restrictive covenant' };
    }

    const radius = num(readField(extracted, 'non_compete_radius_miles').value);
    const months = num(readField(extracted, 'non_compete_duration_months').value);

    // Present but unbounded on either axis is the version that causes trouble,
    // and it is a stated term rather than silence, so it is scored.
    if (radius === null || months === null) {
      return { points: 0, band: 'Present, scope not bounded in writing' };
    }
    if (radius <= 25 && months <= 12) {
      return { points: Math.round(spec.possible * 0.75), band: 'Narrow and time-limited' };
    }
    if (radius <= 50 && months <= 24) {
      return { points: Math.round(spec.possible * 0.3), band: 'Moderate scope' };
    }
    return { points: 0, band: 'Broad scope' };
  }
};

function letterFor(pct, thresholds) {
  for (let i = 0; i < thresholds.length; i++) {
    if (pct >= thresholds[i].min) return thresholds[i].letter;
  }
  return 'F';
}

function scoreContract(extracted, rubric) {
  if (!extracted || !rubric || !rubric.fields) {
    throw new Error('scoreContract requires extracted fields and a rubric');
  }

  const scored = [];
  const clarifications = [];

  Object.keys(rubric.fields).forEach(function (key) {
    const spec = rubric.fields[key];
    let result = null;
    let quote = '';
    let value = null;
    let unsupported = false;

    if (spec.type === 'derived') {
      const fn = DERIVATIONS[spec.derivation];
      if (fn) result = fn(spec, extracted);
    } else {
      const read = readField(extracted, key);
      value = read.value;
      quote = read.quote;

      // A stated term must be traceable to contract text. A value with no
      // quote is the model asserting something it cannot point at, which is
      // exactly how "not mentioned" turns into a scored "none". Drop it.
      if (value !== null && value !== undefined && !String(quote).trim()) {
        unsupported = true;
        value = null;
      }

      if (!unsupported) {
        if (spec.type === 'number') result = scoreNumberField(spec, value);
        else if (spec.type === 'enum') result = scoreEnumField(spec, value);
      }
    }

    if (result === null) {
      if (spec.clarifyWhenNull !== false) {
        clarifications.push({
          key: key,
          label: spec.label,
          tier: spec.tier,
          question: spec.clarifyAsk || spec.ask || '',
          questionOffer: spec.clarifyAskOffer || spec.clarifyAsk || spec.ask || '',
          // The model found relevant language but could not fit it to the
          // field type. Show it: the CRNA can read it even if we cannot score it.
          relatedText: quote || '',
          unsupportedValue: unsupported
        });
      }
      return; // excluded from numerator AND denominator
    }

    // Some stated values are scored but still worth raising with the recruiter.
    if ((spec.clarifyWhenValue || []).indexOf(String(value)) !== -1) {
      clarifications.push({
        key: key,
        label: spec.label,
        tier: spec.tier,
        question: spec.clarifyAskForValue || spec.ask || '',
        questionOffer: spec.clarifyAskForValue || spec.ask || '',
        relatedText: quote || '',
        unsupportedValue: false
      });
    }

    const points = Math.max(0, Math.min(spec.possible, result.points));
    scored.push({
      key: key,
      label: spec.label,
      tier: spec.tier,
      category: spec.category,
      value: value,
      quote: quote,
      band: result.band,
      points: points,
      possible: spec.possible,
      lost: spec.possible - points,
      why: spec.why || '',
      ask: spec.ask || '',
      fallback: spec.fallback || ''
    });
  });

  const sum = function (arr, f) { return arr.reduce(function (a, b) { return a + f(b); }, 0); };
  const pct = function (list) {
    const poss = sum(list, function (f) { return f.possible; });
    if (!poss) return null;
    return Math.round((sum(list, function (f) { return f.points; }) / poss) * 1000) / 10;
  };

  // A category's full weight, whether or not those fields were stated. Used to
  // decide whether enough of the category is present to show a letter at all.
  const categoryCeiling = {};
  Object.keys(rubric.fields).forEach(function (k) {
    const sp = rubric.fields[k];
    categoryCeiling[sp.category] = (categoryCeiling[sp.category] || 0) + sp.possible;
  });

  const minCatFields = rubric.minCategoryFields || 3;
  const minCatShare = rubric.minCategoryPossibleShare || 0.4;

  const categories = {};
  ['financial', 'protection', 'lifestyle'].forEach(function (cat) {
    const list = scored.filter(function (f) { return f.category === cat; });
    const p = pct(list);
    const possible = sum(list, function (f) { return f.possible; });
    const ceiling = categoryCeiling[cat] || 0;
    // Two light-tier fields should never produce an F for a whole category.
    const enough = list.length >= minCatFields && ceiling > 0 && (possible / ceiling) >= minCatShare;
    categories[cat] = {
      points: sum(list, function (f) { return f.points; }),
      possible: possible,
      pct: p,
      letter: (p === null || !enough) ? null : letterFor(p, rubric.thresholds),
      fieldsScored: list.length,
      insufficient: !enough
    };
  });

  const overallPct = pct(scored);
  const totalFields = Object.keys(rubric.fields).length;
  const minShare = rubric.provisionalBelowScoredShare || 0.6;
  const scoredShare = totalFields ? (scored.length / totalFields) : 0;

  // Priorities: what cost the most points, heaviest tier first. Cap at three,
  // because a recruiter gives you two or three concessions, not eight.
  const minLoss = rubric.minPriorityLoss || 2;
  const priorities = scored
    .filter(function (f) { return f.lost >= minLoss; })
    .sort(function (a, b) {
      if (b.lost !== a.lost) return b.lost - a.lost;
      return TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
    })
    .slice(0, 3)
    .map(function (f, i) {
      return {
        rank: i + 1,
        key: f.key,
        label: f.label,
        currentTerm: f.band,
        quote: f.quote,
        why: f.why,
        ask: f.ask,
        fallback: f.fallback || '',
        priority: f.tier === 'heavy' ? 'High' : (f.tier === 'moderate' ? 'Moderate' : 'Low')
      };
    });

  const notWorthFighting = scored
    .filter(function (f) { return f.lost > 0 && f.tier === 'light'; })
    .map(function (f) { return { key: f.key, label: f.label, currentTerm: f.band }; });

  const strengths = scored
    .filter(function (f) { return f.lost === 0 && f.tier !== 'light'; })
    .sort(function (a, b) { return b.possible - a.possible; })
    .map(function (f) { return { key: f.key, label: f.label, term: f.band, quote: f.quote }; });

  // Negotiation level answers a different question than the grade. The grade
  // says how good the contract is; the level says what to do about it. Both
  // are computed from the same scored fields, so they cannot disagree.
  const cfg = rubric.negotiationLevels || {};
  const heavy = scored.filter(function (f) { return f.tier === 'heavy'; });
  const heavyLost = heavy.filter(function (f) { return f.lost > 0; }).length;
  const heavyZeroed = heavy.filter(function (f) { return f.points === 0; }).length;
  // Signable must also account for the moderate tier. Tail on you scores zero
  // without touching a heavy field, and that is plainly worth an ask.
  const nonLightZeroed = scored.filter(function (f) {
    return f.tier !== 'light' && f.points === 0;
  }).length;

  let levelCode;
  if (scoredShare < minShare) {
    levelCode = 'CLARIFY_FIRST';
  } else if (overallPct < (cfg.rethinkBelowPct || 60)
             || heavyZeroed >= (cfg.rethinkHeavyZeroed || 3)) {
    levelCode = 'RETHINK';
  } else if (heavyLost <= (cfg.signableMaxHeavyLosses || 0)
             && nonLightZeroed <= (cfg.signableMaxNonLightZeroed || 1)
             && overallPct >= (cfg.signableMinPct || 85)) {
    levelCode = 'SIGNABLE';
  } else {
    levelCode = 'NEGOTIATE';
  }

  const levelCopy = (cfg.copy && cfg.copy[levelCode]) || {};

  return {
    rubricVersion: rubric.version,
    level: {
      code: levelCode,
      label: levelCopy.label || levelCode,
      headline: levelCopy.headline || '',
      detail: levelCopy.detail || '',
      heavyLost: heavyLost,
      heavyZeroed: heavyZeroed,
      nonLightZeroed: nonLightZeroed
    },
    overall: {
      points: sum(scored, function (f) { return f.points; }),
      possible: sum(scored, function (f) { return f.possible; }),
      pct: overallPct,
      letter: overallPct === null ? null : letterFor(overallPct, rubric.thresholds),
      fieldsScored: scored.length,
      fieldsTotal: totalFields,
      scoredShare: Math.round(scoredShare * 100) / 100,
      provisional: scoredShare < minShare
    },
    categories: categories,
    priorities: priorities,
    notWorthFighting: notWorthFighting,
    strengths: strengths,
    clarifications: clarifications,
    fields: scored
  };
}

// Rate is graded on its own band and never folded into the overall letter. A
// strong rate should not paper over CRNA-funded tail, and a fair rural rate
// should not drag down an otherwise clean contract.
function gradeRate(hourly, rubric) {
  const cfg = (rubric && rubric.rateBands) || {};
  const bands = cfg.bands || [];
  const n = Number(hourly);
  if (!isFinite(n) || n <= 0 || !bands.length) return null;
  for (let i = 0; i < bands.length; i++) {
    if (n >= bands[i].min) {
      return {
        letter: bands[i].letter,
        label: bands[i].label,
        note: bands[i].note,
        basis: cfg.basis || '',
        hourly: n
      };
    }
  }
  return null;
}

// Works in the Netlify bundle and in the browser. The offer summary page needs
// the same scorer the contract analyzer uses; two implementations would drift.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { scoreContract, gradeRate };
}
if (typeof window !== 'undefined') {
  window.scoreContract = scoreContract;
  window.gradeRate = gradeRate;
}
