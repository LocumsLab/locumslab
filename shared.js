/* LocumsLab Offer Summary — shared logic (pure functions, no DOM/network deps except getSupabase) */
/* © 2026 LocumsLab. All rights reserved. LocumsLab™. */

// PROFESSION NOTE
// ---------------
// Two professions now: 'crna_locums' and 'travel_rn'. An offer with no
// profession is CRNA, which is what every offer written before this change is,
// so nothing here changes behaviour for existing rows.
//
// The authoritative package math and terms table live server-side in
// netlify/functions/lib/offer-display.js, because that is the only place that
// holds the rubric. What is here serves the ONE case that cannot call the
// server: the live preview in offer-form.html, which runs before the offer
// exists. Keep the two in agreement — if you change the blended formula here,
// change rnPackage() there.

function money(n, digits = 0) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: digits
  }).format(Number(n) || 0);
}

// money() coerces null and undefined to $0, which reads as a stated figure of
// zero rather than an absent one. Use this anywhere a missing value must look
// missing.
function moneyOrDash(n) {
  return (n === null || n === undefined || !isFinite(Number(n)) || Number(n) === 0)
    ? '\u2014' : money(n);
}

function text(v, fallback = 'Not provided') {
  return (v === null || v === undefined || String(v).trim() === '') ? fallback : String(v).trim();
}

function normaliseProfession(v) {
  const s = String(v || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (s === 'travel_rn' || s === 'rn' || s === 'travel' || s === 'travel_nursing' || s === 'nurse') {
    return 'travel_rn';
  }
  return 'crna_locums';
}

/**
 * Turns raw form fields into the numbers the candidate page displays.
 * Intentionally calculates ONLY gross figures — no taxes, no net take-home,
 * no staff-vs-locums comparison. Those require the candidate's own inputs.
 *
 * For travel nursing the package is a taxable hourly base plus weekly housing
 * and meal stipends. They are added here and never anywhere else, and the
 * resulting hourly figure is flagged `blended` so no page can render it as if
 * it were a wage.
 */
function normalizeOffer(raw) {
  const profession = normaliseProfession(raw.profession);
  const hours = Number(raw.guaranteed_hours) || 0;
  const weeks = Number(raw.contract_weeks) || 0;

  if (profession === 'travel_rn') {
    const base = Number(raw.taxable_base_hourly) || 0;
    const housing = Number(raw.weekly_housing_stipend) || 0;
    const mie = Number(raw.weekly_mie_stipend) || 0;
    const statedWeekly = Number(raw.blended_weekly_total) || 0;

    const stipend = housing + mie;
    const taxableWeekly = base * hours;

    // Prefer the split. A stated weekly total is a fallback, and when it is all
    // we have the split is unknown rather than zero.
    const hasSplit = base > 0 && stipend > 0 && hours > 0;
    const weeklyGross = hasSplit ? taxableWeekly + stipend : statedWeekly;
    const blendedHourly = (weeklyGross && hours) ? weeklyGross / hours : 0;

    return {
      ...raw,
      profession,
      rate_type: 'weekly',
      rate: weeklyGross,
      guaranteed_hours: hours,
      contract_weeks: weeks,
      taxable_base_hourly: base,
      weekly_stipend: hasSplit ? stipend : null,
      taxable_weekly: hasSplit ? taxableWeekly : null,
      // Share of the package that behaves like a wage. Null when the agency
      // gave a blended figure only, because an unknown split is not a low one.
      taxable_share: hasSplit ? taxableWeekly / weeklyGross : null,
      weekly_gross: weeklyGross,
      contract_gross: weeklyGross * weeks,
      effective_hourly: blendedHourly,
      is_blended: true,
      rate_label: 'Blended hourly equivalent'
    };
  }

  const rateType = raw.rate_type || 'hourly';
  const rate = Number(raw.rate) || 0;

  const weeklyGross = rateType === 'weekly' ? rate : rate * hours;
  const effectiveHourly = (rateType === 'weekly' && hours) ? rate / hours : rate;
  const contractGross = weeklyGross * weeks;

  return {
    ...raw,
    profession,
    rate_type: rateType,
    rate,
    guaranteed_hours: hours,
    contract_weeks: weeks,
    weekly_gross: weeklyGross,
    contract_gross: contractGross,
    effective_hourly: effectiveHourly,
    is_blended: false,
    rate_label: 'Effective hourly rate'
  };
}

/**
 * Generates the "Before accepting, clarify" list from whatever the recruiter
 * left blank, unknown, or only partially specified.
 *
 * This is the PREVIEW list, used before an offer is saved. Once it exists, the
 * authoritative list comes from the rubric via score-offer.js. Keep this one
 * short and obvious rather than trying to mirror the rubric — a preview that
 * disagrees with the real grade is worse than a preview that says less.
 */
function clarificationItems(o) {
  const items = [];
  const unknown = (v) => !v || v === 'unknown' || v === 'not-confirmed';

  if (!o.guaranteed_hours) {
    items.push("Guaranteed hours per week weren't provided. Confirm how many hours are contractually protected each week.");
  }
  if (!o.contract_weeks) {
    items.push("The contract length wasn't provided. Confirm how many weeks this assignment covers.");
  }
  if (unknown(o.cancellation_notice)) {
    items.push("The cancellation notice period was not provided. Ask what notice either party must give to end the contract early.");
  }

  if (normaliseProfession(o.profession) === 'travel_rn') {
    // The four that decide what a travel assignment actually pays.
    if (!o.taxable_base_hourly || (!o.weekly_housing_stipend && !o.weekly_mie_stipend)) {
      items.push("The taxable base and the stipends aren't broken out. That split decides overtime, guaranteed-hours pay, and tax exposure, so it is the first thing to ask for.");
    }
    if (unknown(o.cancelled_shift_stipend)) {
      items.push("What happens to the stipend when a shift is cancelled hasn't been stated. Losing the hours and losing the stipend are different amounts, and the stipend is usually the larger one.");
    }
    if (unknown(o.guaranteed_hours_pay)) {
      items.push("What rate guaranteed hours actually pay hasn't been stated. A guarantee paid at the taxable base only is worth roughly half what most nurses assume.");
    }
    if (unknown(o.float_scope)) {
      items.push("Float scope hasn't been defined. Ask which specific units the nurse can be assigned to, and whether that list is in the contract.");
    }
    return items;
  }

  if (unknown(o.malpractice)) {
    items.push("Malpractice coverage hasn't been confirmed. Ask whether coverage is provided for this assignment.");
  }
  if (unknown(o.tail)) {
    items.push("Tail malpractice coverage has not been confirmed. Ask whether the policy is claims-made or occurrence, and who pays for tail if it applies.");
  } else if (o.malpractice === 'claims-made' && o.tail === 'not-included') {
    items.push("Coverage is claims-made and tail is not included. Ask who is responsible for tail coverage when the assignment ends.");
  }
  if (unknown(o.call_required)) {
    items.push("Whether call is required hasn't been confirmed.");
  } else if (o.call_required === 'yes') {
    items.push("Call is required, but call-back or on-call pay wasn't specified. Ask how call is compensated.");
  }
  if (unknown(o.travel_support)) {
    items.push("Housing and travel support haven't been confirmed.");
  } else if (o.travel_support === 'stipend' || o.travel_support === 'partial') {
    const label = o.travel_support === 'stipend' ? 'a stipend' : 'partial reimbursement';
    items.push(`Housing is offered as ${label} rather than fully provided housing. Confirm whether the amount is realistic for this assignment's location.`);
  }

  return items;
}

/** Human-readable labels for stored option values. */
const LABELS = {
  // shared
  'unknown': 'Not confirmed',
  'not-confirmed': 'Not confirmed',
  'stipend': 'Stipend or reimbursement',
  'occurrence': 'Occurrence coverage',
  'claims-made': 'Claims-made coverage',
  'not-needed': 'Not applicable',
  'not_applicable': 'Not applicable',

  // CRNA locums
  'fully-covered': 'Fully covered',
  'partial': 'Partially covered',
  'candidate-paid': 'Candidate responsible',
  'yes': 'Required',
  'no': 'Not required',
  'provided': 'Provided, type not specified',
  'candidate': 'Candidate responsible',
  'included': 'Tail included',
  'not-included': 'Tail not included',

  // travel RN — stipend and cancellation
  'full': 'Paid in full',
  'prorated': 'Prorated for missed time',
  'forfeited': 'Forfeited for missed time',
  'not_prorated': 'Not reduced',
  'hourly': 'Hour by hour',
  'per_shift': 'Per shift missed',
  'weekly_threshold': 'Below a weekly hours threshold',
  'blended': 'The full blended rate',
  'base_plus_stipend': 'Base plus stipend',
  'base_only': 'Taxable base only',
  'not_paid': 'Not paid',
  'facility_exempt': "Facility cancellations don't count against the nurse",
  'partial_distinction': 'Partly distinguished',
  'no_distinction': 'Treated the same',
  'no_penalty': 'No penalty',
  'hours_only': 'Loses the hours only',
  'makeup_shift': 'Make-up shift required',
  'stipend_penalty': 'Stipend penalty',
  'treated_as_cause': 'Treated as cause',

  // travel RN — float, schedule, clawback
  'named_units': 'Named units only',
  'comparable_acuity': 'Comparable acuity or competency',
  'department_only': 'Within the department',
  'facility_wide': 'Anywhere in the facility',
  'any_facility': 'Any facility in the system',
  'excluded': 'Excluded',
  'paid_differential': 'Paid at a differential',
  'required_unpaid': 'Required, no differential',
  'none': 'None',
  'cause_only': 'Only if the nurse leaves for cause',
  'full_repayment': 'Full repayment',
  'conversion_fee_only': 'Conversion fee only',
  'restricted_under_12_months': 'Restricted, under 12 months',
  'restricted_12_months_or_more': 'Restricted, 12 months or more',
  'named_and_provided': 'Named and provided to the nurse',
  'named_not_provided': 'Named but not provided',
  'open_ended': 'Policies as amended from time to time',
  'agency': 'Agency pays',
  'nurse': 'Nurse pays',
  'split': 'Split',
  'not_needed': 'Not applicable',

  // profession
  'crna_locums': 'CRNA locum tenens',
  'travel_rn': 'Travel nursing assignment'
};
function pretty(v) { return LABELS[v] || text(v); }

/** Cryptographically random URL-safe token for public/edit links. */
function randomToken(bytes = 18) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}

function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

/**
 * Supabase client. Requires config.js to define window.LOCUMSLAB_CONFIG with
 * a REAL project URL + anon key — see config.js for setup instructions.
 */
function getSupabase() {
  const c = window.LOCUMSLAB_CONFIG;
  if (!c || !c.supabaseUrl || !c.supabaseAnonKey || !window.supabase) return null;
  if (c.supabaseUrl.includes('YOUR-PROJECT')) return null; // placeholder not yet filled in
  return window.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey);
}
