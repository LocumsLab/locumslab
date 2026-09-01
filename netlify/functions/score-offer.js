/* LocumsLab — © 2026 LocumsLab. All rights reserved.
 * LocumsLab™ is a trademark of LocumsLab.
 */

// Scores a recruiter-entered offer without exposing the rubric.
//
// The offer page used to fetch rubric-v1.json, score-contract.js and
// map-offer-to-rubric.js directly, which published the field weights and
// thresholds to anyone who opened the URL. This keeps all of them inside the
// function bundle and returns only the result.
//
// Public by design: the candidate has no account, and the token is the only
// thing they hold. It reads nothing it isn't given.
//
// v1.1: profession-aware. The offer row carries `profession`, and rubrics.js
// picks the rubric and the mapper from it. An offer with no profession is a
// CRNA offer, which is what every row written before this change is.

const { scoreContract, gradeRate } = require('./lib/score-contract');
const { profileFor, normaliseProfession } = require('./lib/rubrics');
const { buildDisplay } = require('./lib/offer-display');

// The effective figure the rate band is graded against. For CRNA that is the
// hourly rate. For travel RN it is the blended hourly equivalent: taxable base
// plus stipends, divided by guaranteed hours. They are different scales and
// they are graded against different bands, which is why this returns the basis
// string alongside the number.
function effectiveHourly(offer, profession) {
  const n = function (v) {
    const x = Number(v);
    return isFinite(x) && x > 0 ? x : null;
  };
  const hours = n(offer.guaranteed_hours) || n(offer.weekly_hours);

  if (profession === 'travel_rn') {
    const base = n(offer.taxable_base_hourly);
    const housing = Number(offer.weekly_housing_stipend) || 0;
    const mie = Number(offer.weekly_mie_stipend) || 0;
    const weekly = n(offer.blended_weekly_total);

    if (base !== null && (housing || mie) && hours) {
      return {
        hourly: (base * hours + housing + mie) / hours,
        blended: true,
        basis: 'Taxable base plus weekly stipends, divided by ' + hours + ' guaranteed hours.'
      };
    }
    if (weekly !== null && hours) {
      return {
        hourly: weekly / hours,
        blended: true,
        basis: 'Weekly gross divided by ' + hours + ' guaranteed hours. The agency did not break out the taxable base.'
      };
    }
    // Without hours there is no honest hourly figure. Do not invent 36.
    return { hourly: null, blended: true, basis: '' };
  }

  const rate = n(offer.rate);
  if (rate === null) return { hourly: null, blended: false, basis: '' };
  if (offer.rate_type === 'weekly' && hours) {
    return {
      hourly: rate / hours,
      blended: false,
      basis: 'Weekly rate divided by ' + hours + ' guaranteed hours.'
    };
  }
  return { hourly: rate, blended: false, basis: 'Stated hourly by the agency.' };
}

exports.handler = async (event) => {
  const json = (statusCode, payload) => ({
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      // Same-origin only. The offer page is the only intended caller.
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(payload)
  });

  if (event.httpMethod !== 'POST') {
    return json(405, { success: false, error: 'Method Not Allowed' });
  }

  let offer;
  try {
    ({ offer } = JSON.parse(event.body || '{}'));
  } catch (e) {
    return json(400, { success: false, error: 'Malformed request body.' });
  }

  if (!offer || typeof offer !== 'object') {
    return json(400, { success: false, error: 'No offer data was received.' });
  }

  try {
    const profession = normaliseProfession(offer.profession);
    const profile = profileFor(profession);
    const rubric = profile.rubric;

    const extracted = profile.mapOffer(offer);
    const score = scoreContract(extracted, rubric);

    const eff = effectiveHourly(offer, profession);
    score.rate = {
      hourly: eff.hourly,
      blended: eff.blended,
      basis: eff.basis,
      label: profile.rateLabel,
      band: gradeRate(eff.hourly, rubric)
    };

    // Only what the page renders. No weights, no thresholds, no field points.
    const safeFields = {};
    Object.keys(extracted).forEach(function (k) {
      const f = extracted[k];
      safeFields[k] = { value: f && typeof f === 'object' ? f.value : f };
    });

    // Whitelist what goes out. Tier names, point totals and the counts behind
    // the level all describe how the rubric is built, so none of them ship.
    // shareBands, reads and the exposure figures inside a derived band label
    // are checked here too: the band string is written for the nurse to read
    // and contains no weights.
    const outPriorities = (score.priorities || []).map(function (p) {
      return {
        rank: p.rank, key: p.key, label: p.label, currentTerm: p.currentTerm,
        why: p.why, ask: p.ask, fallback: p.fallback, priority: p.priority
      };
    });
    const outClarifications = (score.clarifications || []).map(function (c) {
      return { key: c.key, label: c.label, question: c.question, questionOffer: c.questionOffer };
    });
    const outStrengths = (score.strengths || []).map(function (x) {
      return { key: x.key, label: x.label, term: x.term };
    });

    // The package math and the stated-terms table. Built here so the pages stop
    // reading extracted.<key>.value directly, which threw on any profession
    // whose mapper emits a different key set.
    const display = buildDisplay(offer, extracted, score, profession, rubric);

    return json(200, {
      success: true,
      score: {
        rubricVersion: score.rubricVersion,
        profession: profession,
        professionLabel: profile.label,
        overall: {
          letter: score.overall.letter,
          provisional: score.overall.provisional,
          fieldsScored: score.overall.fieldsScored,
          fieldsTotal: score.overall.fieldsTotal
        },
        level: {
          code: score.level.code,
          label: score.level.label,
          headline: score.level.headline,
          detail: score.level.detail
        },
        rate: {
          hourly: score.rate.hourly,
          blended: score.rate.blended,
          basis: score.rate.basis,
          label: score.rate.label,
          band: score.rate.band ? {
            letter: score.rate.band.letter,
            label: score.rate.band.label,
            note: score.rate.band.note,
            basis: score.rate.band.basis
          } : null
        },
        priorities: outPriorities,
        clarifications: outClarifications,
        strengths: outStrengths,
        display: display
      },
      extracted: safeFields
    });
  } catch (error) {
    console.error('score-offer error:', error && error.message);
    return json(500, { success: false, error: 'The offer could not be scored.' });
  }
};
