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
//
// PROFESSION NEUTRALITY (v1.1)
// ----------------------------
// This engine holds no profession-specific knowledge. Everything that differs
// between CRNA locums and travel RN lives in the rubric JSON:
//   - which fields exist, their tiers, weights and bands
//   - which categories exist (read from rubric.categoryMeta, not hardcoded)
//   - thresholds, negotiation levels, rate bands, minimums
//
// Derived fields are the one exception, because they read more than one key and
// so cannot be expressed in JSON. They are kept in this file rather than a
// separate module for two reasons: this file still exports a browser global, so
// a require() graph would break any page that loads it directly, and a single
// file cannot drift against itself. A rubric names the derivation it wants via
// `spec.derivation`, and can remap the keys that derivation reads via
// `spec.reads`, so adding a profession usually needs no code change here.
// A caller that genuinely needs a new derivation can inject one:
//
//   scoreContract(extracted, rubric, { derivations: { my_field: fn } })

const TIER_ORDER = { heavy: 0, moderate: 1, light: 2 };
const DEFAULT_CATEGORIES = ['financial', 'protection', 'lifestyle'];

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

// "Not applicable" is not "zero". A callback rate on an assignment with no
// callback cannot cost the clinician anything, so it scores full marks rather
// than being penalised or nagged about in clarifications.
function isNotApplicable(v) {
  return typeof v === 'string' && v.trim().toLowerCase() === 'not_applicable';
}

function scoreNumberField(spec, value) {
  const bands = spec.bands || [];
  if (isNotApplicable(value)) {
    return { points: spec.possible, band: 'Not applicable' };
  }
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

// ---- derivation helpers ---------------------------------------------------

// Derivations read extracted keys by name. A rubric can remap those names with
// `spec.reads`, so the same derivation serves two professions whose extraction
// prompts use different vocabulary (termination_notice_crna_days vs
// termination_notice_nurse_days).
function keyFor(spec, role, fallback) {
  const reads = (spec && spec.reads) || {};
  return reads[role] || fallback;
}

function readNum(extracted, spec, role, fallback) {
  return num(readField(extracted, keyFor(spec, role, fallback)).value);
}

function readRaw(extracted, spec, role, fallback) {
  return readField(extracted, keyFor(spec, role, fallback)).value;
}

function money(n) {
  return '$' + Math.round(n).toLocaleString();
}

// ---- derived fields -------------------------------------------------------
// These read more than one extracted key, so they cannot live in the JSON.
// Each returns null when there is not enough stated information to score,
// which routes the field to clarifications.

const BUILTIN_DERIVATIONS = {

  // ---- shared across professions ----

  overtime: function (spec, extracted) {
    const threshold = readNum(extracted, spec, 'threshold', 'overtime_threshold_hours');
    const multRaw = readRaw(extracted, spec, 'multiplier', 'overtime_multiplier');
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
    const agency = readNum(extracted, spec, 'agency', 'termination_notice_agency_days');
    const clinician = readNum(extracted, spec, 'clinician', 'termination_notice_crna_days');
    if (agency === null || clinician === null) return null;

    const gap = clinician - agency; // positive means you owe more notice than they do
    if (gap <= 0) return { points: spec.possible, band: 'Symmetric or favorable to you' };
    if (gap <= 7) return { points: Math.round(spec.possible * 0.6), band: 'Slightly asymmetric' };
    if (gap <= 21) return { points: Math.round(spec.possible * 0.2), band: 'Materially asymmetric' };
    return { points: 0, band: 'Heavily asymmetric' };
  },

  // ---- CRNA locums ----

  non_compete: function (spec, extracted) {
    const present = readRaw(extracted, spec, 'present', 'non_compete_present');
    if (present === null || present === undefined) return null;
    if (present === false || String(present).toLowerCase() === 'false') {
      return { points: spec.possible, band: 'No restrictive covenant' };
    }

    const radius = readNum(extracted, spec, 'radius', 'non_compete_radius_miles');
    const months = readNum(extracted, spec, 'months', 'non_compete_duration_months');

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
  },

  // ---- travel RN ----

  // The question this exists to answer: if a shift is cancelled, do you lose
  // the stipend too, or only the hours? In a blended travel package the stipend
  // is usually the larger half, so a contract that pays four hours of taxable
  // base and forfeits a day of stipend has paid you almost nothing.
  //
  // Scored on what the contract SAYS about stipend treatment. The dollar figure
  // is attached to the band when the package is stated in enough detail to
  // compute it, and omitted when it is not. A missing dollar figure never
  // changes the points.
  stipend_on_cancellation: function (spec, extracted) {
    const treatmentRaw = readRaw(extracted, spec, 'treatment', 'cancelled_shift_stipend_treatment');
    if (treatmentRaw === null || treatmentRaw === undefined) return null;
    const treatment = String(treatmentRaw).trim().toLowerCase();

    const table = spec.points || {};
    if (!Object.prototype.hasOwnProperty.call(table, treatment)) return null;
    const points = table[treatment];

    const label = {
      full: 'Stipend paid in full on a cancelled shift',
      prorated: 'Stipend prorated down for the cancelled shift',
      forfeited: 'Stipend forfeited for the cancelled shift'
    }[treatment] || treatment.replace(/_/g, ' ');

    // ---- optional exposure figure ----
    const base = readNum(extracted, spec, 'base', 'taxable_base_hourly');
    const housing = readNum(extracted, spec, 'housing', 'weekly_housing_stipend');
    const mie = readNum(extracted, spec, 'mie', 'weekly_mie_stipend');
    const guaranteed = readNum(extracted, spec, 'hours', 'guaranteed_hours_weekly');
    const shiftHours = readNum(extracted, spec, 'shift', 'shift_length_hours');
    const paidRaw = readRaw(extracted, spec, 'paidHours', 'cancellation_pay_hours');
    const prorationRaw = readRaw(extracted, spec, 'proration', 'stipend_proration_basis');
    const proration = prorationRaw === null || prorationRaw === undefined
      ? null : String(prorationRaw).trim().toLowerCase();

    const weeklyStipend = (housing === null && mie === null)
      ? null : (housing || 0) + (mie || 0);
    const shift = shiftHours || 12;
    const hoursBasis = guaranteed || (shift * 3);

    let band = label;

    if (base !== null && weeklyStipend !== null && hoursBasis > 0) {
      const paidHours = isExplicitNone(paidRaw) ? 0 : (num(paidRaw) || 0);
      const unpaidHours = Math.max(0, shift - paidHours);
      const lostWage = unpaidHours * base;

      let lostStipend = 0;
      if (treatment === 'forfeited' && proration === 'weekly_threshold') {
        // The worst version: missing hours drops you under a weekly threshold
        // and the entire week's stipend goes, not a shift's worth.
        lostStipend = weeklyStipend;
      } else if (treatment === 'forfeited' || treatment === 'prorated') {
        lostStipend = (weeklyStipend / hoursBasis) * shift;
      }

      const total = lostWage + lostStipend;
      if (total > 0) {
        band = label + ' — one cancelled ' + shift + '-hour shift costs ' + money(total);
        if (lostStipend > 0) band += ', of which ' + money(lostStipend) + ' is stipend';
        if (treatment === 'forfeited' && proration === 'weekly_threshold') {
          band += ' (a full week of stipend, because the contract uses a weekly hours threshold)';
        }
      }
    }

    return { points: points, band: band, exposureShown: band !== label };
  },

  // Stipends are only tax-free if the taxable base is a reasonable wage for the
  // work. A base far below what a staff nurse in that role would earn, paired
  // with large stipends, is the pattern the IRS treats as disguised wages, and
  // the back-tax exposure falls on the nurse rather than the agency.
  //
  // Scored on the SHARE of the package that is taxable, never on a dollar
  // threshold, because there is no defensible national dollar line and a rule
  // stated in dollars would be wrong in half the country.
  wage_recharacterization_risk: function (spec, extracted) {
    const base = readNum(extracted, spec, 'base', 'taxable_base_hourly');
    const housing = readNum(extracted, spec, 'housing', 'weekly_housing_stipend');
    const mie = readNum(extracted, spec, 'mie', 'weekly_mie_stipend');
    const guaranteed = readNum(extracted, spec, 'hours', 'guaranteed_hours_weekly');
    const expected = readNum(extracted, spec, 'expectedHours', 'weekly_hours_expected');

    const hours = guaranteed || expected;
    if (base === null || hours === null || hours <= 0) return null;
    if (housing === null && mie === null) return null;

    const weeklyStipend = (housing || 0) + (mie || 0);
    const weeklyTaxable = base * hours;
    const weeklyTotal = weeklyTaxable + weeklyStipend;
    if (weeklyTotal <= 0) return null;

    const taxableShare = weeklyTaxable / weeklyTotal;
    const bands = spec.shareBands || [];
    for (let i = 0; i < bands.length; i++) {
      if (taxableShare >= bands[i].gte || bands[i].gte === null) {
        const pct = Math.round(taxableShare * 100);
        return {
          points: bands[i].points,
          band: bands[i].label + ' — taxable base is ' + pct + '% of the weekly package ('
                + money(weeklyTaxable) + ' taxable, ' + money(weeklyStipend) + ' stipend)',
          taxableShare: Math.round(taxableShare * 1000) / 1000
        };
      }
    }
    return null;
  }
};

function letterFor(pct, thresholds) {
  for (let i = 0; i < thresholds.length; i++) {
    if (pct >= thresholds[i].min) return thresholds[i].letter;
  }
  return 'F';
}

function scoreContract(extracted, rubric, options) {
  if (!extracted || !rubric || !rubric.fields) {
    throw new Error('scoreContract requires extracted fields and a rubric');
  }

  const derivations = Object.assign(
    {}, BUILTIN_DERIVATIONS, (options && options.derivations) || {}
  );

  const scored = [];
  const clarifications = [];

  Object.keys(rubric.fields).forEach(function (key) {
    const spec = rubric.fields[key];
    let result = null;
    let quote = '';
    let value = null;
    let unsupported = false;

    if (spec.type === 'derived') {
      const fn = derivations[spec.derivation];
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
          // Some absences are worth asking about before others regardless of
          // weight. A rubric can pin one to the top with clarifyRank.
          rank: typeof spec.clarifyRank === 'number' ? spec.clarifyRank : 100,
          question: spec.clarifyAsk || spec.ask || '',
          questionOffer: spec.clarifyAskOffer || spec.clarifyAsk || spec.ask || '',
          // The model found relevant language but could not fit it to the
          // field type. Show it: the clinician can read it even if we cannot score it.
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
        rank: typeof spec.clarifyRank === 'number' ? spec.clarifyRank : 100,
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

  // Stable sort: pinned clarifications first, then rubric order.
  clarifications.sort(function (a, b) { return a.rank - b.rank; });

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

  // Categories come from the rubric, not from this file. A profession that
  // needs different category names only edits its JSON.
  const categoryNames = rubric.categoryMeta
    ? Object.keys(rubric.categoryMeta)
    : DEFAULT_CATEGORIES;

  const categories = {};
  categoryNames.forEach(function (cat) {
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
    profession: rubric.profession || null,
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
// strong rate should not paper over clinician-funded tail, and a fair rural rate
// should not drag down an otherwise clean contract.
//
// The bands live in the rubric, so a travel RN blended-hourly scale and a CRNA
// locums hourly scale use this same function with no branching.
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
  module.exports = { scoreContract, gradeRate, BUILTIN_DERIVATIONS };
}
if (typeof window !== 'undefined') {
  window.scoreContract = scoreContract;
  window.gradeRate = gradeRate;
}
