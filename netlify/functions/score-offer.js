/* LocumsLab — © 2026 LocumsLab. All rights reserved.
 * LocumsLab™ is a trademark of LocumsLab.
 */

// Scores a recruiter-entered offer without exposing the rubric.
//
// The offer page used to fetch rubric-v1.json, score-contract.js and
// map-offer-to-rubric.js directly, which published the field weights and
// thresholds to anyone who opened the URL. This keeps all three inside the
// function bundle and returns only the result.
//
// Public by design: the candidate has no account, and the token is the only
// thing they hold. It reads nothing it isn't given.

const { scoreContract, gradeRate } = require('./lib/score-contract');
const { mapOfferToExtracted } = require('./lib/map-offer-to-rubric');
const RUBRIC = require('./lib/rubric-v1.json');

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
    const extracted = mapOfferToExtracted(offer);
    const score = scoreContract(extracted, RUBRIC);

    // Effective hourly, computed the same way the page used to.
    const rate = Number(offer.rate) || 0;
    const hours = Number(offer.guaranteed_hours) || 0;
    const effectiveHourly = (offer.rate_type === 'weekly' && hours) ? (rate / hours) : rate;
    score.rate = { hourly: effectiveHourly, band: gradeRate(effectiveHourly, RUBRIC) };

    // Only what the page renders. No weights, no thresholds, no field points.
    const safeFields = {};
    Object.keys(extracted).forEach(function (k) {
      const f = extracted[k];
      safeFields[k] = { value: f && typeof f === 'object' ? f.value : f };
    });

    // Whitelist what goes out. Tier names, point totals and the counts behind
    // the level all describe how the rubric is built, so none of them ship.
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

    return json(200, {
      success: true,
      score: {
        rubricVersion: score.rubricVersion,
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
          band: score.rate.band ? {
            letter: score.rate.band.letter,
            label: score.rate.band.label,
            note: score.rate.band.note,
            basis: score.rate.band.basis
          } : null
        },
        priorities: outPriorities,
        clarifications: outClarifications,
        strengths: outStrengths
      },
      extracted: safeFields
    });
  } catch (error) {
    console.error('score-offer error:', error && error.message);
    return json(500, { success: false, error: 'The offer could not be scored.' });
  }
};
