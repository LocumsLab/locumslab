/* LocumsLab — © 2026 LocumsLab. All rights reserved.
 * LocumsLab™ is a trademark of LocumsLab.
 * This file, including the rubric weights, field definitions and explanatory copy,
 * is proprietary. Not licensed for reuse or redistribution.
 */
/* LocumsLab — CRNA locums offer form to rubric adapter.
 *
 * One of a pair. The travel RN equivalent is map-offer-to-rubric-rn.js.
 * rubrics.js picks between them by profession; nothing else should require
 * either one directly.
 *
 * One rubric, two inputs. The contract analyzer produces `extracted` from a
 * signed document; this produces the same shape from what a recruiter typed
 * into the offer form. Both then run through scoreContract().
 *
 * The important consequence: a recruiter who fills in eight fields gets a
 * provisional grade and a long clarification list, because eight stated terms
 * is not an offer, it is a headline. Filling in more moves the grade. That is
 * the incentive we want.
 *
 * Every value carries a `quote` of what the recruiter actually entered, so the
 * quote-support rule in score-contract.js treats these the same as contract
 * language. A field the recruiter left blank stays null and routes to
 * clarifications rather than being scored as unfavorable.
 */

const UNKNOWN = ['', 'unknown', 'not-confirmed', 'n/a', null, undefined];

function isUnknown(v) {
  return UNKNOWN.indexOf(v === null || v === undefined ? v : String(v).trim().toLowerCase()) !== -1;
}

function f(value, quote) {
  if (value === null || value === undefined || value === '') return { value: null, quote: '' };
  return { value: value, quote: quote || 'Stated by the agency on the offer summary.' };
}

function numOrNull(v) {
  const n = Number(v);
  return isFinite(n) && n > 0 ? n : null;
}

// The offer form stores option values like "14 days" and "60+ days". The rubric
// needs an integer, and a silent null here would push every cancellation notice
// into clarifications instead of scoring it.
function daysOrNull(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return isFinite(v) && v > 0 ? v : null;
  const m = String(v).match(/\d+/);
  return m ? Number(m[0]) : null;
}

function mapOfferToExtracted(raw) {
  const o = raw || {};
  const rate = numOrNull(o.rate);
  const rateType = (o.rate_type || 'hourly').toLowerCase();
  const hours = numOrNull(o.guaranteed_hours);
  const weeks = numOrNull(o.contract_weeks);

  const e = {};

  // ---- identity and context -------------------------------------------
  e.agency_name = f(o.agency_name || null);
  e.facility_name = f(o.facility_name || null);
  e.state = f(o.state || null);
  e.start_date = f(o.start_date || null);
  e.specialty_mix = f(o.specialty || null);

  // ---- rate -----------------------------------------------------------
  // rate_type on the form is hourly or weekly. Anything else is passed
  // through so normaliseRate can handle it or decline to.
  if (rate) {
    e.pay_rate_amount = f(rate, 'Rate entered by the agency: ' + rate);
    e.pay_rate_unit = f(rateType === 'weekly' ? 'weekly' : rateType, rateType);
    e.base_hourly_rate = rateType === 'hourly' ? f(rate, 'Hourly rate entered by the agency.') : f(null);
  } else {
    e.pay_rate_amount = f(null);
    e.pay_rate_unit = f(null);
    e.base_hourly_rate = f(null);
  }

  e.guaranteed_hours_weekly = f(hours, hours ? hours + ' guaranteed hours per week.' : '');
  e.weekly_hours_expected = f(hours);
  e.contract_length_weeks = f(weeks, weeks ? weeks + ' week assignment.' : '');

  // ---- terms the form asks about --------------------------------------
  e.cancellation_notice_days = f(isUnknown(o.cancellation_notice) ? null : daysOrNull(o.cancellation_notice));

  e.malpractice_type = f(
    isUnknown(o.malpractice) ? null
    : o.malpractice === 'occurrence' ? 'occurrence'
    : o.malpractice === 'claims-made' ? 'claims_made'
    : null  // "provided, type not specified" is not a stated type
  );

  e.tail_responsibility = f(
    isUnknown(o.tail) ? null
    : o.tail === 'included' ? 'agency'
    : o.tail === 'candidate' ? 'crna'
    : o.tail === 'not-needed' ? 'not_applicable'
    : o.tail === 'not-included' ? 'crna'
    : null
  );

  // "Candidate responsible" for malpractice implies the CRNA also carries tail.
  if (o.malpractice === 'candidate' && e.tail_responsibility.value === null) {
    e.tail_responsibility = f('crna', 'Agency stated the candidate is responsible for malpractice coverage.');
  }

  // "Call required" without a pay structure is not the same as unpaid call.
  e.call_pay_structure = f(
    isUnknown(o.call_required) ? null
    : o.call_required === 'no' ? 'none_required'
    : (o.call_pay || null)
  );
  e.call_frequency = f(
    isUnknown(o.call_required) ? null
    : o.call_required === 'no' ? 'none'
    : (o.call_frequency || null)
  );

  const travel = isUnknown(o.travel_support) ? null : o.travel_support;
  e.travel_reimbursement = f(
    travel === 'fully-covered' ? 'actual'
    : travel === 'stipend' ? 'stipend'
    : travel === 'partial' ? 'mileage'
    : travel === 'candidate-paid' ? 'none'
    : null
  );
  e.housing = f(
    travel === 'fully-covered' ? 'provided'
    : travel === 'stipend' ? 'stipend'
    : travel === 'candidate-paid' ? 'none'
    : null
  );

  // If the offer says no callback is required, the callback rate cannot hurt
  // the clinician. That is not the same as callback paid at straight time.
  //
  // Written to a local rather than back onto `o`, which is the caller's object.
  let callbackMultiplier = o.callback_multiplier;
  if (o.callback_multiplier === 'none_required'
      || o.call_pay === 'none_required'
      || o.call_required === 'no') {
    if (isUnknown(o.callback_multiplier) || o.callback_multiplier === 'none_required') {
      callbackMultiplier = 'not_applicable';
    }
  }

  // ---- optional extended fields ---------------------------------------
  // Present only if the offer form is extended to collect them. Absent stays
  // null, which routes to clarifications rather than scoring as unfavorable.
  const passthrough = [
    'payment_terms_days', 'overtime_threshold_hours', 'overtime_multiplier',
    'callback_multiplier', 'cancellation_pay_hours', 'shift_length_hours',
    'site_count', 'schedule_guarantee', 'indemnification', 'exclusivity_clause',
    'auto_renewal', 'unilateral_scope_change', 'non_compete_present',
    'non_compete_radius_miles', 'non_compete_duration_months',
    'termination_notice_agency_days', 'termination_notice_crna_days',
    'credentialing_expense', 'licensure_expense'
  ];
  passthrough.forEach(function (k) {
    const v = k === 'callback_multiplier' ? callbackMultiplier : o[k];
    e[k] = f(isUnknown(v) ? null : v);
  });

  return e;
}

// Offer summaries are the agency's description, not the executed contract.
// Anything built on this must say so.
const OFFER_DISCLAIMER =
  'This grade reflects what the agency stated on this offer summary, not a signed contract. '
  + 'Terms that are not listed here have not been confirmed either way. Run the actual contract '
  + 'through LocumsLab before you sign, and compare the two.';

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mapOfferToExtracted, OFFER_DISCLAIMER };
}
if (typeof window !== 'undefined') {
  window.mapOfferToExtracted = mapOfferToExtracted;
  window.OFFER_DISCLAIMER = OFFER_DISCLAIMER;
}
