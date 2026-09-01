/* LocumsLab — © 2026 LocumsLab. All rights reserved.
 * LocumsLab™ is a trademark of LocumsLab.
 */
// The display model for an offer: the package math, the stated-terms table, and
// the completeness count.
//
// Why this is server-side rather than in each page:
//
// offer.html and offer-workspace.html each built their own terms table by
// reading extracted.<key>.value directly, with no null guard. Nineteen of those
// reads between them. The CRNA mapper always emits every key so it never threw,
// but the RN mapper emits a different key set, so the first travel RN offer
// would have thrown a TypeError inside the try block and painted "Offer
// unavailable" over a perfectly good grade. Same failure shape as the
// sb.rpc(...).catch bug: an error after a successful render.
//
// Building the table here fixes that structurally. A key that does not exist
// reads as "Not stated", which is the honest answer and the one the page
// already knows how to draw.
//
// The completeness count also moves here. offer-edit.html and
// offer-workspace.html each kept their own 27-item SCORED array; adding a
// profession would have made four hand-maintained lists. The rubric already
// knows how many fields it grades.

function val(extracted, key) {
  const f = extracted && extracted[key];
  if (f === undefined || f === null) return null;
  const v = (typeof f === 'object' && !Array.isArray(f)) ? f.value : f;
  return (v === undefined || v === '') ? null : v;
}

function num(v) {
  const n = Number(v);
  return isFinite(n) && n > 0 ? n : null;
}

function money(n) {
  if (n === null || n === undefined || !isFinite(n)) return null;
  return '$' + Math.round(n).toLocaleString();
}

// A row renders as "Not stated" whenever fmt returns null, which is also what
// happens when the key is absent from this profession's field set.
function row(label, value, fmt) {
  if (value === null || value === undefined || value === '') {
    return { label: label, value: null, stated: false };
  }
  const out = fmt ? fmt(value) : String(value);
  return out === null || out === undefined
    ? { label: label, value: null, stated: false }
    : { label: label, value: String(out), stated: true };
}

const YESNO = function (v) { return (v === true || v === 'true') ? 'Yes' : 'None'; };

// ---------------------------------------------------------------------------
// CRNA locums
// ---------------------------------------------------------------------------
function crnaTerms(e) {
  return [
    row('Cancellation notice', val(e, 'cancellation_notice_days'), function (v) { return v + ' days'; }),
    row('Cancelled shift pay', val(e, 'cancellation_pay_hours'), function (v) {
      return v === 'none' ? 'Unpaid' : v + ' hours paid'; }),
    row('Malpractice coverage', val(e, 'malpractice_type'), function (v) {
      return v === 'occurrence' ? 'Occurrence' : 'Claims-made'; }),
    row('Tail coverage', val(e, 'tail_responsibility'), function (v) {
      return v === 'agency' ? 'Agency pays' : v === 'crna' ? 'You pay' : 'Not applicable'; }),
    row('Call', val(e, 'call_pay_structure'), function (v) {
      return v === 'none_required' ? 'Not required' : v === 'hourly' ? 'Paid hourly'
           : v === 'stipend' ? 'Stipend' : 'Unpaid'; }),
    row('Housing', val(e, 'housing'), function (v) {
      return v === 'provided' ? 'Provided' : v === 'stipend' ? 'Stipend' : 'On you'; }),
    row('Travel', val(e, 'travel_reimbursement'), function (v) {
      return v === 'actual' ? 'Actual cost' : v === 'stipend' ? 'Stipend'
           : v === 'mileage' ? 'Mileage' : 'On you'; }),
    row('Payment terms', val(e, 'payment_terms_days'), function (v) { return 'Net ' + v; }),
    row('Overtime', val(e, 'overtime_multiplier'), function (v) {
      return v === 'none' ? 'Straight time' : v + '\u00d7'; }),
    row('Schedule', val(e, 'schedule_guarantee'), function (v) {
      return v === 'fixed' ? 'Fixed in contract' : v === 'posted_in_advance'
           ? 'Posted in advance' : 'Set by facility'; }),
    row('Indemnification', val(e, 'indemnification'), function (v) {
      return v === 'mutual' ? 'Mutual' : 'You only'; }),
    row('Restrictive covenant', val(e, 'non_compete_present'), YESNO)
  ];
}

function crnaPackage(offer, extracted, rate) {
  const hours = num(offer.guaranteed_hours);
  const weeks = num(offer.contract_weeks);
  const r = num(offer.rate);

  let weekly = null;
  if (r !== null) weekly = offer.rate_type === 'weekly' ? r : (hours ? r * hours : null);
  const contract = (weekly !== null && weeks) ? weekly * weeks : null;

  return {
    rows: [
      { label: 'Weekly guaranteed gross', value: money(weekly) },
      { label: 'Guaranteed contract gross', value: money(contract) },
      { label: 'Effective hourly rate', value: rate.hourly ? money(rate.hourly) + '/hr' : null }
    ],
    note: (hours && weeks)
      ? hours + ' hours \u00d7 ' + weeks + ' weeks at the stated rate. Before tax, before overtime '
        + 'and call, and before anything you pay for yourself.'
      : 'A gross figure needs the guaranteed hours and the contract length, which this offer does not state.'
  };
}

// ---------------------------------------------------------------------------
// Travel RN
// ---------------------------------------------------------------------------
function rnTerms(e) {
  return [
    // The stipend question leads, because it is the term that most often makes
    // the assignment pay less than the weekly number the recruiter quoted.
    row('Stipend if a shift is cancelled', val(e, 'cancelled_shift_stipend_treatment'), function (v) {
      return v === 'full' ? 'Paid in full' : v === 'prorated' ? 'Prorated down' : 'Forfeited'; }),
    row('Cancelled shift pay', val(e, 'cancellation_pay_hours'), function (v) {
      return v === 'none' ? 'Unpaid' : v + ' hours paid'; }),
    row('Guaranteed hours pay at', val(e, 'guaranteed_hours_pay_basis'), function (v) {
      return v === 'blended' ? 'Full blended rate'
           : v === 'base_plus_stipend' ? 'Base plus stipend'
           : v === 'base_only' ? 'Taxable base only' : 'Not paid'; }),
    row('Stipend reduced by', val(e, 'stipend_proration_basis'), function (v) {
      return v === 'not_prorated' ? 'Not reduced'
           : v === 'hourly_prorated' ? 'Hour by hour'
           : v === 'shift_prorated' ? 'Per shift' : 'Weekly hours threshold'; }),
    row('Facility vs your call-offs', val(e, 'call_off_cause_distinction'), function (v) {
      return v === 'facility_exempt' ? 'Facility cancellations exempt'
           : v === 'partial_distinction' ? 'Partly distinguished' : 'Treated the same'; }),
    row('Facility call-off cap', val(e, 'call_off_cap'), function (v) {
      return v === 'none' ? 'Uncapped' : v + ' over the assignment'; }),
    row('If you call off', val(e, 'self_cancel_policy'), function (v) {
      return v === 'no_penalty' ? 'No penalty' : v === 'hours_only' ? 'Lose the hours only'
           : v === 'makeup_shift' ? 'Make-up shift' : v === 'stipend_penalty'
           ? 'Stipend penalty' : 'Treated as cause'; }),
    row('Cancellation notice', val(e, 'cancellation_notice_days'), function (v) { return v + ' days'; }),
    row('Float scope', val(e, 'float_scope'), function (v) {
      return v === 'named_units' ? 'Named units only' : v === 'comparable_acuity' ? 'Comparable acuity'
           : v === 'department_only' ? 'Department only' : v === 'facility_wide'
           ? 'Anywhere in the facility' : 'Any facility'; }),
    row('Schedule', val(e, 'schedule_guarantee'), function (v) {
      return v === 'fixed' ? 'Fixed in contract' : v === 'posted_in_advance'
           ? 'Posted in advance' : 'Set by facility'; }),
    row('Bonus clawback', val(e, 'bonus_clawback'), function (v) {
      return v === 'none' ? 'None' : v === 'prorated' ? 'Prorated by weeks worked'
           : v === 'cause_only' ? 'Only if you leave for cause' : 'Full repayment'; }),
    row('Returning to the facility', val(e, 'facility_return_restriction'), function (v) {
      return v === 'none' ? 'No restriction' : v === 'conversion_fee_only' ? 'Conversion fee only'
           : v === 'restricted_under_12_months' ? 'Restricted under 12 months' : 'Restricted 12+ months'; }),
    row('Other documents you\'re bound by', val(e, 'incorporation_by_reference'), function (v) {
      return v === 'none' ? 'None' : v === 'named_and_provided' ? 'Named and provided'
           : v === 'named_not_provided' ? 'Named but not provided' : 'Open-ended'; }),
    row('Charge duty', val(e, 'charge_duty'), function (v) {
      return v === 'excluded' ? 'Excluded' : v === 'paid_differential' ? 'Paid differential' : 'Required, unpaid'; }),
    row('Malpractice coverage', val(e, 'malpractice_type'), function (v) {
      return v === 'occurrence' ? 'Occurrence' : 'Claims-made'; }),
    row('Tail coverage', val(e, 'tail_responsibility'), function (v) {
      return v === 'agency' ? 'Agency pays' : v === 'nurse' ? 'You pay'
           : v === 'split' ? 'Split' : 'Not applicable'; }),
    row('Travel', val(e, 'travel_reimbursement'), function (v) {
      return v === 'actual' ? 'Actual cost' : v === 'stipend' ? 'Stipend'
           : v === 'mileage' ? 'Mileage' : 'On you'; }),
    row('License and certs', val(e, 'license_reimbursement'), function (v) {
      return v === 'agency' ? 'Agency pays' : v === 'split' ? 'Split'
           : v === 'not_applicable' ? 'Not applicable' : 'You pay'; })
  ];
}

function rnPackage(offer, extracted, rate) {
  const hours = num(offer.guaranteed_hours) || num(offer.weekly_hours);
  const weeks = num(offer.contract_weeks);
  const base = num(offer.taxable_base_hourly);
  const housing = Number(offer.weekly_housing_stipend) || 0;
  const mie = Number(offer.weekly_mie_stipend) || 0;
  const stipend = (housing || mie) ? housing + mie : null;
  const stated = num(offer.blended_weekly_total);

  let weekly = null, taxable = null;
  if (base !== null && stipend !== null && hours) {
    taxable = base * hours;
    weekly = taxable + stipend;
  } else if (stated !== null) {
    weekly = stated;
  }
  const contract = (weekly !== null && weeks) ? weekly * weeks : null;

  const rows = [
    { label: 'Weekly gross', value: money(weekly) },
    { label: 'Assignment gross', value: money(contract) },
    // Always labelled blended. A nurse comparing an unlabelled $62/hr against a
    // staff wage is comparing two different things, and the taxable half of
    // this figure is the only part that behaves like a wage.
    { label: 'Blended hourly', value: rate.hourly ? money(rate.hourly) + '/hr' : null }
  ];

  let note;
  if (taxable !== null) {
    const pct = Math.round((taxable / weekly) * 100);
    note = money(taxable) + ' of that is taxable wages (' + pct + '%) and '
         + money(stipend) + ' is housing and meal stipend. Blended hourly divides the whole '
         + 'package across ' + hours + ' hours, so it is not comparable to a staff wage. '
         + 'Stipends are only tax-free if you maintain a tax home.';
  } else if (weekly !== null) {
    note = 'The agency gave a weekly figure but did not break out the taxable base and the '
         + 'stipends, so how much of this behaves like a wage is unknown. That split decides '
         + 'your overtime, your guaranteed-hours pay, and your tax exposure.';
  } else {
    note = 'A weekly figure needs either the taxable base and stipends, or a stated weekly gross.';
  }

  return { rows: rows, note: note };
}

// ---------------------------------------------------------------------------

const BY_PROFESSION = {
  crna_locums: { terms: crnaTerms, pkg: crnaPackage, noun: 'CRNA locums offer' },
  travel_rn: { terms: rnTerms, pkg: rnPackage, noun: 'Travel nursing assignment' }
};

function buildDisplay(offer, extracted, score, profession, rubric) {
  const impl = BY_PROFESSION[profession] || BY_PROFESSION.crna_locums;
  const terms = impl.terms(extracted);

  const name = [offer.agency_name, offer.facility_name].filter(Boolean).join(' \u00b7 ')
    || (offer.state ? 'Assignment in ' + offer.state : impl.noun);

  // Counted from the rubric rather than a hand-kept list of form fields, so it
  // cannot drift and it reports the number that actually drives the grade.
  const scoredCount = score.overall.fieldsScored;
  const totalCount = score.overall.fieldsTotal;

  return {
    professionNoun: impl.noun,
    headline: name,
    package: impl.pkg(offer, extracted, score.rate || {}),
    terms: terms,
    completeness: {
      scored: scoredCount,
      total: totalCount,
      missing: totalCount - scoredCount,
      pct: totalCount ? Math.round((scoredCount / totalCount) * 100) : 0
    }
  };
}

module.exports = { buildDisplay };
