/* LocumsLab Offer Summary — shared logic (pure functions, no DOM/network deps except getSupabase) */

function money(n, digits = 0) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: digits
  }).format(Number(n) || 0);
}

function text(v, fallback = 'Not provided') {
  return (v === null || v === undefined || String(v).trim() === '') ? fallback : String(v).trim();
}

/**
 * Turns raw form fields into the numbers the candidate page displays.
 * Intentionally calculates ONLY gross figures — no taxes, no net take-home,
 * no staff-vs-locums comparison. Those require the candidate's own inputs.
 */
function normalizeOffer(raw) {
  const rateType = raw.rate_type || 'hourly';
  const rate = Number(raw.rate) || 0;
  const hours = Number(raw.guaranteed_hours) || 0;
  const weeks = Number(raw.contract_weeks) || 0;

  const weeklyGross = rateType === 'weekly' ? rate : rate * hours;
  const effectiveHourly = (rateType === 'weekly' && hours) ? rate / hours : rate;
  const contractGross = weeklyGross * weeks;

  return {
    ...raw,
    rate_type: rateType,
    rate,
    guaranteed_hours: hours,
    contract_weeks: weeks,
    weekly_gross: weeklyGross,
    contract_gross: contractGross,
    effective_hourly: effectiveHourly,
  };
}

/**
 * Generates the "Before accepting, clarify" list from whatever the recruiter
 * left blank, unknown, or only partially specified. This list is the actual
 * product — the gross math is secondary.
 */
function clarificationItems(o) {
  const items = [];

  if (!o.guaranteed_hours) {
    items.push("Guaranteed hours per week weren't provided. Confirm how many hours are contractually protected each week.");
  }
  if (!o.contract_weeks) {
    items.push("The contract length wasn't provided. Confirm how many weeks this assignment covers.");
  }
  if (!o.cancellation_notice || o.cancellation_notice === 'unknown') {
    items.push("The cancellation notice period was not provided. Ask what notice either party must give to end the contract early.");
  }
  if (!o.malpractice || o.malpractice === 'unknown') {
    items.push("Malpractice coverage hasn't been confirmed. Ask whether coverage is provided for this assignment.");
  }
  if (!o.tail || o.tail === 'unknown') {
    items.push("Tail malpractice coverage has not been confirmed. Ask whether the policy is claims-made or occurrence, and who pays for tail if it applies.");
  } else if (o.malpractice === 'claims-made' && o.tail === 'not-included') {
    items.push("Coverage is claims-made and tail is not included. Ask who is responsible for tail coverage when the assignment ends.");
  }
  if (!o.call_required || o.call_required === 'unknown') {
    items.push("Whether call is required hasn't been confirmed.");
  } else if (o.call_required === 'yes') {
    items.push("Call is required, but call-back or on-call pay wasn't specified. Ask how call is compensated.");
  }
  if (!o.travel_support || o.travel_support === 'unknown') {
    items.push("Housing and travel support haven't been confirmed.");
  } else if (o.travel_support === 'stipend' || o.travel_support === 'partial') {
    const label = o.travel_support === 'stipend' ? 'a stipend' : 'partial reimbursement';
    items.push(`Housing is offered as ${label} rather than fully provided housing. Confirm whether the amount is realistic for this assignment's location.`);
  }

  return items;
}

/** Human-readable labels for stored option values. */
const LABELS = {
  'fully-covered': 'Fully covered',
  'stipend': 'Stipend or reimbursement',
  'partial': 'Partially covered',
  'candidate-paid': 'Candidate responsible',
  'yes': 'Required',
  'no': 'Not required',
  'provided': 'Provided, type not specified',
  'occurrence': 'Occurrence coverage',
  'claims-made': 'Claims-made coverage',
  'candidate': 'Candidate responsible',
  'included': 'Tail included',
  'not-included': 'Tail not included',
  'not-needed': 'Not applicable',
  'unknown': 'Not confirmed',
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
