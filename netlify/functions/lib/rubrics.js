/* LocumsLab — © 2026 LocumsLab. All rights reserved.
 * LocumsLab™ is a trademark of LocumsLab.
 */
// One place that knows which rubric and which offer mapper belong to which
// profession. Every caller reads profession off the row rather than sniffing
// the extracted fields, so a contract is graded against the rubric it was
// submitted under and nothing else.
//
// Adding a profession is: a rubric JSON, a mapper, and one entry here.

const CRNA_RUBRIC = require('./rubric-v1.json');
const RN_RUBRIC = require('./rubric-rn-v1.json');
const { mapOfferToExtracted } = require('./map-offer-to-rubric');
const { mapRnOfferToExtracted } = require('./map-offer-to-rubric-rn');

const DEFAULT_PROFESSION = 'crna_locums';

const REGISTRY = {
  crna_locums: {
    profession: 'crna_locums',
    label: 'CRNA locum tenens',
    rubric: CRNA_RUBRIC,
    mapOffer: mapOfferToExtracted,
    // Which extracted key holds the figure the rate band is computed from, and
    // how the client should label it.
    rateLabel: 'Hourly rate',
    rateIsBlended: false
  },
  travel_rn: {
    profession: 'travel_rn',
    label: 'Travel nursing assignment',
    rubric: RN_RUBRIC,
    mapOffer: mapRnOfferToExtracted,
    rateLabel: 'Blended hourly equivalent',
    rateIsBlended: true
  }
};

// Accepts anything a client might send and returns a known profession key.
// Unknown values fall back to CRNA, which is what every existing row and every
// existing client already means when it sends nothing.
function normaliseProfession(value) {
  if (!value) return DEFAULT_PROFESSION;
  const v = String(value).trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (Object.prototype.hasOwnProperty.call(REGISTRY, v)) return v;
  // Tolerate the shorthands the clients have used at various points.
  if (v === 'rn' || v === 'travel' || v === 'travel_nursing' || v === 'nurse') return 'travel_rn';
  if (v === 'crna' || v === 'locums' || v === 'crna_locum') return 'crna_locums';
  return DEFAULT_PROFESSION;
}

function profileFor(value) {
  return REGISTRY[normaliseProfession(value)];
}

function rubricFor(value) {
  return profileFor(value).rubric;
}

function mapperFor(value) {
  return profileFor(value).mapOffer;
}

// True when the rubric declares it grades this contract type. Kept as its own
// check rather than folded into profileFor, because the honest answer for an
// unsupported type is "no grade", not "graded against the wrong rubric".
function rubricApplies(rubric, profession) {
  return (rubric.appliesTo || []).indexOf(normaliseProfession(profession)) !== -1;
}

module.exports = {
  REGISTRY,
  DEFAULT_PROFESSION,
  normaliseProfession,
  profileFor,
  rubricFor,
  mapperFor,
  rubricApplies
};
