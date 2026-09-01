/* LocumsLab — © 2026 LocumsLab. All rights reserved.
 * LocumsLab™ is a trademark of LocumsLab.
 * This file, including the rubric weights, field definitions and explanatory copy,
 * is proprietary. Not licensed for reuse or redistribution.
 */
/* LocumsLab — travel RN offer form to rubric adapter.
 *
 * Same contract with the engine as the CRNA mapper: produce the `extracted`
 * shape, attach a quote to every stated value, leave anything the recruiter
 * skipped as null so it routes to clarifications rather than scoring as
 * unfavorable.
 *
 * What differs is the pay model. A CRNA offer has a rate. A travel RN offer has
 * a taxable base, a housing stipend, and a meal stipend, and the recruiter's
 * headline number is the three of them added together. The mapper accepts
 * either shape: an explicit split when the form collected one, or a weekly
 * blended total when it did not. A blended total alone is NOT enough to score
 * the split, so taxable_base_hourly stays null in that case and the nurse gets
 * the question instead of a guess.
 */

const UNKNOWN = ['', 'unknown', 'not-confirmed', 'not-sure', 'n/a', null, undefined];

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

// Zero is meaningful for stipends and call-off caps, unlike a rate.
function numOrNullAllowZero(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isFinite(n) && n >= 0 ? n : null;
}

// The offer form stores option values like "14 days" and "30+ days". The rubric
// needs an integer, and a silent null here would push every cancellation notice
// into clarifications instead of scoring it.
function daysOrNull(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return isFinite(v) && v > 0 ? v : null;
  const m = String(v).match(/\d+/);
  return m ? Number(m[0]) : null;
}

function pick(v, table) {
  if (isUnknown(v)) return null;
  const key = String(v).trim().toLowerCase().replace(/[\s-]+/g, '_');
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null;
}

function mapRnOfferToExtracted(raw) {
  const o = raw || {};
  const e = {};

  // ---- identity and context -------------------------------------------
  e.agency_name = f(o.agency_name || null);
  e.facility_name = f(o.facility_name || null);
  e.unit = f(o.unit || null);
  e.state = f(o.state || null);
  e.start_date = f(o.start_date || null);
  e.specialty = f(o.specialty || null);

  const weeks = numOrNull(o.contract_weeks);
  e.contract_length_weeks = f(weeks, weeks ? weeks + ' week assignment.' : '');

  const hours = numOrNull(o.guaranteed_hours);
  e.guaranteed_hours_weekly = f(hours, hours ? hours + ' guaranteed hours per week.' : '');
  e.weekly_hours_expected = f(numOrNull(o.weekly_hours) || hours);

  const shift = numOrNull(o.shift_length_hours);
  e.shift_length_hours = f(shift, shift ? shift + '-hour shifts.' : '');

  // ---- the pay package -------------------------------------------------
  // Three numbers, entered separately. The blended figure is computed
  // downstream, never here, so the basis for it stays visible.
  const base = numOrNull(o.taxable_base_hourly);
  const housing = numOrNullAllowZero(o.weekly_housing_stipend);
  const mie = numOrNullAllowZero(o.weekly_mie_stipend);
  const weeklyTotal = numOrNull(o.blended_weekly_total);

  e.taxable_base_hourly = f(base, base ? 'Taxable hourly base entered by the agency: $' + base + '/hr.' : '');
  e.weekly_housing_stipend = f(housing, housing === null ? '' : 'Weekly housing stipend entered by the agency: $' + housing + '.');
  e.weekly_mie_stipend = f(mie, mie === null ? '' : 'Weekly meal stipend entered by the agency: $' + mie + '.');
  e.blended_weekly_total = f(weeklyTotal, weeklyTotal ? 'Weekly gross entered by the agency: $' + weeklyTotal + '.' : '');

  // Display rate. Prefer the split, because a split the agency stated is the
  // only version we can stand behind. Fall back to the weekly total.
  if (base !== null && (housing !== null || mie !== null) && hours) {
    const blended = (base * hours + (housing || 0) + (mie || 0)) / hours;
    e.pay_rate_amount = f(Math.round(blended * 100) / 100, 'Blended from the stated base and stipends.');
    e.pay_rate_unit = f('hourly_blended', 'hourly_blended');
  } else if (weeklyTotal) {
    e.pay_rate_amount = f(weeklyTotal, 'Weekly gross entered by the agency.');
    e.pay_rate_unit = f('weekly', 'weekly');
  } else {
    e.pay_rate_amount = f(null);
    e.pay_rate_unit = f(null);
  }

  // ---- cancellation and stipend ---------------------------------------
  e.cancellation_notice_days = f(
    isUnknown(o.cancellation_notice) ? null : daysOrNull(o.cancellation_notice)
  );

  e.cancellation_pay_hours = f(
    isUnknown(o.cancellation_pay_hours) ? null
    : String(o.cancellation_pay_hours).trim().toLowerCase() === 'none' ? 'none'
    : numOrNullAllowZero(o.cancellation_pay_hours)
  );

  // The question this whole rubric exists to answer. The form must offer three
  // options and a "not sure", and "not sure" must stay null.
  e.cancelled_shift_stipend_treatment = f(pick(o.cancelled_shift_stipend, {
    full: 'full',
    paid_in_full: 'full',
    prorated: 'prorated',
    reduced: 'prorated',
    forfeited: 'forfeited',
    lost: 'forfeited',
    none: 'forfeited'
  }), 'Stipend treatment on a cancelled shift, as stated by the agency.');

  e.stipend_proration_basis = f(pick(o.stipend_proration, {
    not_prorated: 'not_prorated',
    flat: 'not_prorated',
    hourly: 'hourly_prorated',
    hourly_prorated: 'hourly_prorated',
    per_shift: 'shift_prorated',
    shift_prorated: 'shift_prorated',
    weekly_threshold: 'weekly_threshold',
    threshold: 'weekly_threshold'
  }));

  e.guaranteed_hours_pay_basis = f(pick(o.guaranteed_hours_pay, {
    blended: 'blended',
    full_package: 'blended',
    base_plus_stipend: 'base_plus_stipend',
    base_only: 'base_only',
    taxable_base_only: 'base_only',
    not_paid: 'not_paid',
    none: 'not_paid'
  }));

  e.call_off_cause_distinction = f(pick(o.call_off_distinction, {
    facility_exempt: 'facility_exempt',
    yes: 'facility_exempt',
    partial: 'partial_distinction',
    partial_distinction: 'partial_distinction',
    no_distinction: 'no_distinction',
    no: 'no_distinction'
  }));

  e.call_off_cap = f(
    isUnknown(o.call_off_cap) ? null : numOrNullAllowZero(o.call_off_cap)
  );

  e.self_cancel_policy = f(pick(o.self_cancel_policy, {
    no_penalty: 'no_penalty',
    none: 'no_penalty',
    hours_only: 'hours_only',
    makeup_shift: 'makeup_shift',
    stipend_penalty: 'stipend_penalty',
    treated_as_cause: 'treated_as_cause',
    cause: 'treated_as_cause'
  }));

  // ---- schedule and float ---------------------------------------------
  e.float_scope = f(pick(o.float_scope, {
    named_units: 'named_units',
    named: 'named_units',
    comparable_acuity: 'comparable_acuity',
    department_only: 'department_only',
    department: 'department_only',
    facility_wide: 'facility_wide',
    hospital_wide: 'facility_wide',
    any_facility: 'any_facility',
    system_wide: 'any_facility'
  }));

  e.schedule_guarantee = f(pick(o.schedule_guarantee, {
    fixed: 'fixed',
    posted_in_advance: 'posted_in_advance',
    facility_discretion: 'facility_discretion'
  }));

  e.charge_duty = f(pick(o.charge_duty, {
    excluded: 'excluded',
    no: 'excluded',
    paid_differential: 'paid_differential',
    paid: 'paid_differential',
    required_unpaid: 'required_unpaid',
    yes: 'required_unpaid'
  }));

  // ---- protection ------------------------------------------------------
  e.bonus_clawback = f(pick(o.bonus_clawback, {
    none: 'none',
    no: 'none',
    prorated: 'prorated',
    cause_only: 'cause_only',
    full_repayment: 'full_repayment',
    full: 'full_repayment'
  }));

  e.facility_return_restriction = f(pick(o.facility_return, {
    none: 'none',
    no: 'none',
    conversion_fee_only: 'conversion_fee_only',
    conversion_fee: 'conversion_fee_only',
    restricted_under_12_months: 'restricted_under_12_months',
    restricted_12_months_or_more: 'restricted_12_months_or_more'
  }));

  e.incorporation_by_reference = f(pick(o.incorporated_documents, {
    none: 'none',
    named_and_provided: 'named_and_provided',
    provided: 'named_and_provided',
    named_not_provided: 'named_not_provided',
    open_ended: 'open_ended'
  }));

  e.malpractice_type = f(
    isUnknown(o.malpractice) ? null
    : o.malpractice === 'occurrence' ? 'occurrence'
    : o.malpractice === 'claims-made' || o.malpractice === 'claims_made' ? 'claims_made'
    : null  // "provided, type not specified" is not a stated type
  );

  e.tail_responsibility = f(
    isUnknown(o.tail) ? null
    : o.tail === 'included' || o.tail === 'agency' ? 'agency'
    : o.tail === 'candidate' || o.tail === 'nurse' || o.tail === 'not-included' ? 'nurse'
    : o.tail === 'not-needed' ? 'not_applicable'
    : o.tail === 'split' ? 'split'
    : null
  );

  // Occurrence coverage makes the tail question moot. That is not the same as
  // the agency agreeing to buy tail, so it is recorded as not applicable.
  if (e.malpractice_type.value === 'occurrence' && e.tail_responsibility.value === null) {
    e.tail_responsibility = f('not_applicable', 'Coverage is stated as occurrence-based, so no tail is required.');
  }

  // ---- expenses --------------------------------------------------------
  e.travel_reimbursement = f(pick(o.travel_support, {
    fully_covered: 'actual',
    actual: 'actual',
    stipend: 'stipend',
    partial: 'mileage',
    mileage: 'mileage',
    candidate_paid: 'none',
    nurse_paid: 'none',
    none: 'none'
  }));

  e.license_reimbursement = f(pick(o.license_costs, {
    agency: 'agency',
    covered: 'agency',
    split: 'split',
    nurse: 'nurse',
    candidate: 'nurse',
    not_needed: 'not_applicable',
    not_applicable: 'not_applicable'
  }));

  // ---- overtime and termination ---------------------------------------
  const otThreshold = numOrNull(o.overtime_threshold_hours);
  e.overtime_threshold_hours = f(otThreshold);
  e.overtime_multiplier = f(
    isUnknown(o.overtime_multiplier) ? null
    : String(o.overtime_multiplier).trim().toLowerCase() === 'none' ? 'none'
    : numOrNull(o.overtime_multiplier)
  );

  e.termination_notice_agency_days = f(
    isUnknown(o.termination_notice_agency) ? null : daysOrNull(o.termination_notice_agency)
  );
  e.termination_notice_nurse_days = f(
    isUnknown(o.termination_notice_nurse) ? null : daysOrNull(o.termination_notice_nurse)
  );

  return e;
}

// Offer summaries are the agency's description, not the executed contract.
// Anything built on this must say so.
const RN_OFFER_DISCLAIMER =
  'This grade reflects what the agency stated on this offer summary, not a signed contract. '
  + 'Terms that are not listed here have not been confirmed either way, and travel assignments '
  + 'often carry a separate confirmation sheet that is part of the agreement. Run the actual '
  + 'contract through LocumsLab before you sign, and compare the two.';

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mapRnOfferToExtracted, RN_OFFER_DISCLAIMER };
}
if (typeof window !== 'undefined') {
  window.mapRnOfferToExtracted = mapRnOfferToExtracted;
  window.RN_OFFER_DISCLAIMER = RN_OFFER_DISCLAIMER;
}
