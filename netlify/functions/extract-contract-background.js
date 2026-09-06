const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const { scoreContract, gradeRate } = require('./lib/score-contract');
const { profileFor, normaliseProfession, rubricApplies } = require('./lib/rubrics');

// Additive. This does NOT replace analyze-contract-background.js. It writes to
// new columns (extracted, score, rubric_version, profession) on the same
// contract_reviews row, so both paths can run against the same contract and be
// compared before anything switches over.
//
// The model's only job here is extraction. It never sees the rubric, never
// assigns a grade, and never writes prose. Grading happens in score-contract.js
// so the same contract always produces the same letter.
//
// v1.1: two professions. CRNA locums and travel RN have separate extraction
// prompts and separate rubrics, selected by the profession on the request.
// Until this change a travel RN contract was skipped entirely and got no grade.
//
// Required env: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const MODEL = 'claude-sonnet-5';

// ---------------------------------------------------------------------------
// Shared extraction discipline. Both prompts open with this, because the rules
// that keep silence from becoming a scored value are the same regardless of
// which profession's terms are being read.
// ---------------------------------------------------------------------------
const EXTRACTION_RULES = `Return ONLY valid JSON, no preamble and no markdown fences. Every key below must be present. Each value is an object:

{ "value": <typed value or null>, "quote": "<verbatim contract text, at most 30 words>" }

THE MOST IMPORTANT RULE: if the contract does not address a term, set "value" to null and "quote" to "". Do not infer, do not assume a market default, and do not treat an absence as an unfavorable value. Silence and an unfavorable stated term are different findings and are handled differently downstream.

Where a numeric field is explicitly stated as absent (for example, the contract says hours are not guaranteed), use the string "none" rather than null. Use null only when the document is silent.`;

const EXTRACTION_TYPE_RULES = `
- A non-null value REQUIRES a verbatim quote. If you cannot quote text supporting the value, the value is null. This applies especially to "none": only use it where the contract affirmatively says the term does not apply.
- The quote must support the specific value. If no sentence states the value directly, the value is null.
- If you find language relevant to a field but it does not fit the required type, set value to null and still put the language in "quote".
- Where SEVERAL clauses address the same field, extract the GENERAL RULE and quote it. Do not extract an exception, carve-out, cap, or limited allowance as if it were the rule. Example: if one clause states that cancelled shifts are paid at four hours, and a separate clause allows the facility a limited number of unpaid cancellations, then cancellation_pay_hours is 4 — the allowance is a carve-out, not the rule. If a field exists for the carve-out itself, put it there; if no field exists for it, leave it out rather than overwriting the general rule with it.
- Never derive a MONETARY value by calculation. Report figures as the contract states them.
- Unit conversion of a stated duration is not derivation. One year is 52 weeks, six months is 26 weeks, ninety days is 13 weeks. Convert and quote the stated term.
- Every quote must be copied verbatim from the contract. Never paraphrase inside a quote. If a value comes from a table, quote the row.`;

const CRNA_SYSTEM_PROMPT = `You extract structured facts from locum tenens contracts. You do not evaluate, grade, rank, or advise. You report only what the document says.

${EXTRACTION_RULES}

Fields and their types:

IDENTIFIERS AND CONTEXT
pay_rate_amount: number, the pay figure exactly as written, in whatever unit the contract uses
pay_rate_unit: one of "hourly", "daily", "shift", "weekly", "biweekly", "monthly", "annual"
base_hourly_rate: number, ONLY when the contract states an hourly figure directly. Leave null for any other unit; the hourly equivalent is computed downstream.
agency_name: string
facility_name: string
state: two-letter US postal code
start_date: YYYY-MM-DD
end_date: YYYY-MM-DD
contract_length_weeks: number
specialty_mix: string, brief

COMPENSATION
guaranteed_hours_weekly: number, or "none" if explicitly not guaranteed
weekly_hours_expected: number
overtime_threshold_hours: number, hours after which overtime begins
overtime_multiplier: number such as 1.5, or "none" if additional hours are paid at straight time
call_pay_structure: one of "none_required", "unpaid", "stipend", "hourly"
callback_multiplier: number, or "none" for straight time
payment_terms_days: number, days from invoice to payment
travel_reimbursement: one of "none", "mileage", "stipend", "actual"
housing: one of "none", "stipend", "provided"
credentialing_expense: one of "agency", "crna", "split"
licensure_expense: one of "agency", "crna", "split"

PROTECTION
cancellation_notice_days: number
cancellation_pay_hours: number, hours of pay guaranteed when a scheduled shift is cancelled, or "none" if the contract states cancelled shifts are unpaid
termination_notice_agency_days: number, notice the agency or facility must give to terminate without cause
termination_notice_crna_days: number, notice the clinician must give to terminate without cause
malpractice_type: one of "occurrence", "claims_made"
tail_responsibility: one of "agency", "crna", "not_applicable"
indemnification: one of "mutual", "crna_only"
non_compete_present: boolean
non_compete_radius_miles: number
non_compete_duration_months: number
exclusivity_clause: boolean, whether the clinician is restricted from other assignments or agencies during the term
auto_renewal: boolean
unilateral_scope_change: boolean, whether the facility may change site or duties without the clinician's agreement

SCHEDULE
schedule_guarantee: one of "fixed", "posted_in_advance", "facility_discretion"
shift_length_hours: number
site_count: number
call_frequency: one of "none", "occasional", "defined_rotation", "undefined"

Type rules:
- indemnification is "mutual" only if the obligation genuinely runs both directions. If only the clinician indemnifies, use "crna_only". If the contract does not address indemnification at all, use null.
- non_compete_radius_miles and non_compete_duration_months are null when a covenant exists but its scope is not stated numerically. Do not estimate.
- pay_rate_amount must never be null when the contract states any compensation figure. This is the single most important field. If the contract says $2,500 per shift, that is pay_rate_amount 2500 and pay_rate_unit "shift".
- Do not infer malpractice_type from a tail clause, or a party's expense obligation from a licensure-maintenance clause.
- unilateral_scope_change is true only where the contract grants that right in the text.${EXTRACTION_TYPE_RULES}`;

const RN_SYSTEM_PROMPT = `You extract structured facts from travel nursing assignment contracts. You do not evaluate, grade, rank, or advise. You report only what the document says.

${EXTRACTION_RULES}

Travel nursing pay is a blended package. The taxable hourly base, the weekly housing stipend and the weekly meal (M&IE) stipend are three separate figures and must be reported separately. Do not add them together. If the contract states only a combined weekly gross, put that in blended_weekly_total and leave the three components null.

Fields and their types:

IDENTIFIERS AND CONTEXT
agency_name: string
facility_name: string
unit: string, the unit or department named for the assignment
state: two-letter US postal code
specialty: string, brief
start_date: YYYY-MM-DD
end_date: YYYY-MM-DD
contract_length_weeks: number
shift_length_hours: number
weekly_hours_expected: number

PAY PACKAGE
taxable_base_hourly: number, the TAXABLE hourly wage only, excluding any stipend
weekly_housing_stipend: number, per week. Use 0 only if the contract states there is none.
weekly_mie_stipend: number, per week, meals and incidentals
blended_weekly_total: number, a combined weekly gross ONLY where the contract states one
pay_rate_amount: number, the headline compensation figure as the contract writes it
pay_rate_unit: one of "hourly", "weekly", "shift", "hourly_blended"
guaranteed_hours_weekly: number, or "none" if explicitly not guaranteed
guaranteed_hours_pay_basis: what guaranteed hours are actually paid at. One of "blended" (full package rate), "base_plus_stipend", "base_only" (taxable wage only), "not_paid". Read this carefully: a guarantee that pays the taxable base only is common and is stated in different words each time. If the contract guarantees hours but does not say at what rate, use null.
overtime_threshold_hours: number
overtime_multiplier: number such as 1.5, or "none" if additional hours are paid at straight time

CANCELLATION AND STIPEND
cancellation_notice_days: number, notice the facility or agency must give to cancel the ASSIGNMENT
cancellation_pay_hours: number, hours of pay guaranteed when a scheduled SHIFT is cancelled, or "none" if the contract states cancelled shifts are unpaid
cancelled_shift_stipend_treatment: what happens to the housing and meal stipend when a shift is cancelled. One of "full" (stipend paid in full regardless), "prorated" (stipend reduced for the missed time), "forfeited" (stipend not paid for the missed time). This is a separate question from cancellation_pay_hours. A contract can pay hours and still cut the stipend, or the reverse. Use null unless the contract addresses the stipend specifically.
stipend_proration_basis: how a stipend reduction is computed. One of "not_prorated", "hourly_prorated", "shift_prorated", "weekly_threshold" (a minimum weekly hours figure below which stipend eligibility is lost). Use null if not stated.
call_off_cause_distinction: whether the contract treats hours the FACILITY cancels differently from hours the nurse calls off, for stipend or guarantee purposes. One of "facility_exempt" (facility cancellations do not reduce stipend or count against the nurse), "partial_distinction", "no_distinction". Use null if the contract does not address the difference.
call_off_cap: number, how many shifts the facility may cancel over the assignment without pay. Use "none" if the contract states cancellations are uncapped.
self_cancel_policy: consequence when the NURSE calls off. One of "no_penalty", "hours_only" (loses the hours and nothing more), "makeup_shift", "stipend_penalty", "treated_as_cause".

SCHEDULE AND FLOAT
float_scope: how far the nurse can be floated. One of "named_units" (specific units listed), "comparable_acuity" (limited to comparable acuity or competency), "department_only", "facility_wide", "any_facility" (including other facilities or system sites).
schedule_guarantee: one of "fixed", "posted_in_advance", "facility_discretion"
charge_duty: one of "excluded", "paid_differential", "required_unpaid"

PROTECTION
bonus_clawback: what must be repaid if the assignment ends early. One of "none", "prorated", "cause_only" (repayable only where the nurse is terminated for cause or resigns), "full_repayment".
facility_return_restriction: one of "none", "conversion_fee_only", "restricted_under_12_months", "restricted_12_months_or_more"
incorporation_by_reference: whether the contract binds the nurse to documents outside it, such as a handbook, policy manual, agency guidelines, or a separate confirmation or assignment sheet. One of "none", "named_and_provided", "named_not_provided", "open_ended" (incorporates policies as amended from time to time, without naming them).
termination_notice_agency_days: number, notice the agency or facility must give to end the assignment without cause
termination_notice_nurse_days: number, notice the nurse must give to end the assignment without cause
malpractice_type: one of "occurrence", "claims_made"
tail_responsibility: one of "agency", "nurse", "split", "not_applicable"
travel_reimbursement: one of "none", "mileage", "stipend", "actual"
license_reimbursement: one of "agency", "nurse", "split", "not_applicable"

Type rules specific to travel nursing:
- taxable_base_hourly is the taxable wage ONLY. If the contract shows a table with a base rate and separate stipend lines, the base rate goes here and the stipends go in their own fields. If it shows only a blended figure, this field is null.
- cancelled_shift_stipend_treatment and cancellation_pay_hours are independent. Extract each from language that addresses it specifically. Do not derive one from the other.
- guaranteed_hours_pay_basis is "base_only" only where the contract says so. Language guaranteeing hours "at the regular hourly rate" where the regular hourly rate is defined elsewhere as the taxable base IS base_only; quote both if needed but quote the operative sentence.
- A weekly minimum hours requirement attached to stipend eligibility is stipend_proration_basis "weekly_threshold", even when the contract does not use the word stipend in that sentence.
- float_scope is "named_units" only where specific units are listed in the document you were given. A reference to units listed on a confirmation sheet you do not have is null, and the confirmation reference belongs in incorporation_by_reference.
- Do not infer tail_responsibility from the coverage type. Occurrence coverage is handled downstream.${EXTRACTION_TYPE_RULES}`;

function systemPromptFor(profession) {
  return profession === 'travel_rn' ? RN_SYSTEM_PROMPT : CRNA_SYSTEM_PROMPT;
}

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });
}

// This function writes exactly the columns it wrote before: extracted, score
// and rubric_version. It deliberately does NOT write a `profession` column.
//
// contract_reviews.contract_type already exists and already holds the same two
// values app.html sends ('crna_locums' and 'travel_rn'), set at insert time by
// the uploader. A second column would be a duplicate source of truth for the
// same fact, and it would put this write at the mercy of a migration that had
// not run yet — Postgres rejects the whole UPDATE on an unknown column, so
// `score` would be lost along with it, silently, via the catch below.
//
// Net effect: no migration is required for the contract analyzer at all. The
// profession discriminator is needed on market_observations, and that write is
// already isolated in its own try/catch so it can never fail a user's review.
async function finish(jobId, patch) {
  if (!jobId) return;
  try {
    const { error } = await db().from('contract_reviews').update(patch).eq('id', jobId);
    if (error) console.error('contract_reviews update rejected:', error.message);
  } catch (e) {
    console.error('Failed writing extraction result:', e && e.message);
  }
}

function fieldValue(extracted, key) {
  const f = extracted[key];
  const v = f && typeof f === 'object' ? f.value : f;
  return v === undefined ? null : v;
}

function fieldNum(extracted, key) {
  const n = Number(fieldValue(extracted, key));
  return isFinite(n) && n > 0 ? n : null;
}

function fieldNumAllowZero(extracted, key) {
  const v = fieldValue(extracted, key);
  if (v === null || v === '') return null;
  const n = Number(v);
  return isFinite(n) && n >= 0 ? n : null;
}

function quoteOf(extracted, key) {
  const f = extracted[key];
  return (f && typeof f === 'object' && typeof f.quote === 'string') ? f.quote : '';
}

// Normalise whatever unit the contract used into an hourly figure. Done here,
// not by the model, so the assumption behind every number is visible and the
// UI can label a derived rate as derived.
function normaliseCrnaRate(extracted) {
  const raw = function (k) {
    const v = fieldValue(extracted, k);
    return typeof v === 'string' ? v.trim().toLowerCase() : null;
  };

  const amount = fieldNum(extracted, 'pay_rate_amount');
  const unit = raw('pay_rate_unit');
  const statedHourly = fieldNum(extracted, 'base_hourly_rate');
  const shiftHours = fieldNum(extracted, 'shift_length_hours');
  const weekHours = fieldNum(extracted, 'weekly_hours_expected') || fieldNum(extracted, 'guaranteed_hours_weekly');
  const quote = quoteOf(extracted, 'pay_rate_amount') || quoteOf(extracted, 'base_hourly_rate');

  if (statedHourly) {
    return { stated: '$' + statedHourly + '/hr', hourly: statedHourly, derived: false, blended: false,
             basis: 'Stated hourly in the contract.', quote: quote };
  }
  if (!amount || !unit) {
    return { stated: null, hourly: null, derived: false, blended: false, basis: '', quote: quote };
  }

  const label = { hourly: '/hr', daily: '/day', shift: '/shift', weekly: '/week',
                  biweekly: ' per two weeks', monthly: '/month', annual: '/year' };
  const stated = '$' + amount.toLocaleString() + (label[unit] || '');

  let hourly = null, basis = '';
  if (unit === 'hourly') { hourly = amount; basis = 'Stated hourly in the contract.'; }
  else if ((unit === 'shift' || unit === 'daily') && shiftHours) {
    hourly = Math.round((amount / shiftHours) * 100) / 100;
    basis = '$' + amount.toLocaleString() + ' divided by the ' + shiftHours + '-hour shift stated in the contract.';
  } else if (unit === 'weekly' && weekHours) {
    hourly = Math.round((amount / weekHours) * 100) / 100;
    basis = '$' + amount.toLocaleString() + ' divided by ' + weekHours + ' hours per week.';
  } else if (unit === 'biweekly' && weekHours) {
    hourly = Math.round((amount / (weekHours * 2)) * 100) / 100;
    basis = '$' + amount.toLocaleString() + ' divided by ' + (weekHours * 2) + ' hours.';
  } else {
    basis = 'Hourly equivalent needs the shift length or weekly hours, which this contract does not state.';
  }

  return { stated: stated, hourly: hourly, derived: hourly !== null && unit !== 'hourly',
           blended: false, unit: unit, basis: basis, quote: quote };
}

// Travel RN pay is a package, not a rate. The displayed figure is the blended
// hourly equivalent and it is always labelled blended, because a nurse
// comparing it against a staff wage is comparing two different things.
function normaliseRnRate(extracted) {
  const base = fieldNum(extracted, 'taxable_base_hourly');
  const housing = fieldNumAllowZero(extracted, 'weekly_housing_stipend');
  const mie = fieldNumAllowZero(extracted, 'weekly_mie_stipend');
  const weeklyTotal = fieldNum(extracted, 'blended_weekly_total');
  const hours = fieldNum(extracted, 'guaranteed_hours_weekly') || fieldNum(extracted, 'weekly_hours_expected');
  const quote = quoteOf(extracted, 'taxable_base_hourly') || quoteOf(extracted, 'blended_weekly_total');

  const stipend = (housing === null && mie === null) ? null : (housing || 0) + (mie || 0);

  if (base !== null && stipend !== null && hours) {
    const weekly = base * hours + stipend;
    return {
      stated: '$' + Math.round(weekly).toLocaleString() + '/week',
      hourly: Math.round((weekly / hours) * 100) / 100,
      derived: true,
      blended: true,
      taxableHourly: base,
      weeklyStipend: stipend,
      unit: 'hourly_blended',
      basis: '$' + base + '/hr taxable across ' + hours + ' hours plus $'
             + Math.round(stipend).toLocaleString() + ' in weekly stipends.',
      quote: quote
    };
  }

  if (weeklyTotal && hours) {
    return {
      stated: '$' + weeklyTotal.toLocaleString() + '/week',
      hourly: Math.round((weeklyTotal / hours) * 100) / 100,
      derived: true,
      blended: true,
      taxableHourly: base,
      weeklyStipend: null,
      unit: 'hourly_blended',
      basis: '$' + weeklyTotal.toLocaleString() + ' weekly gross divided by ' + hours
             + ' hours. The contract does not break out the taxable base, so the split is unknown.',
      quote: quote
    };
  }

  return {
    stated: weeklyTotal ? '$' + weeklyTotal.toLocaleString() + '/week' : null,
    hourly: null,
    derived: false,
    blended: true,
    basis: 'A blended hourly figure needs the weekly hours, which this contract does not state.',
    quote: quote
  };
}

function normaliseRate(extracted, profession) {
  return profession === 'travel_rn' ? normaliseRnRate(extracted) : normaliseCrnaRate(extracted);
}

function rateBand(rate) {
  const n = Number(rate);
  if (!isFinite(n) || n <= 0) return null;
  const lo = Math.floor(n / 10) * 10;
  return lo + '-' + (lo + 9);
}

// Written with no user_id, no review id, and no date finer than the month, so
// there is nothing to join back to a person. Facility name is deliberately
// excluded: facility plus state plus month narrows to an individual fast.
//
// The profession column is what keeps a CRNA hourly rate band and a travel RN
// blended band out of the same bucket. It is written from the rubric, not from
// the request, so a row can never claim a profession the grade did not use.
async function recordObservation(extracted, score, rubric) {
  try {
    const row = {
      rubric_version: rubric.version,
      profession: rubric.marketObservationProfession || rubric.profession || null,
      observed_month: new Date().toISOString().slice(0, 7) + '-01'
    };

    row.rate_unit = (score.rate && score.rate.unit) || null;
    row.rate_is_blended = !!(score.rate && score.rate.blended);

    (rubric.marketObservationFields || []).forEach(function (key) {
      row[key] = fieldValue(extracted, key);
    });

    row.rate_band = rateBand(score.rate && score.rate.hourly);
    row.overall_letter = score.overall.letter;
    row.overall_pct = score.overall.pct;

    await db().from('market_observations').insert(row);
  } catch (e) {
    // Never fail a user's review because the aggregate write failed.
    console.error('market_observations insert failed:', e && e.message);
  }
}

exports.handler = async (event) => {
  const json = (statusCode, payload) => ({
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (event.httpMethod !== 'POST') {
    return json(405, { success: false, error: 'Method Not Allowed' });
  }

  let pdfBase64, contractText, jobId, contractType;
  try {
    ({ pdfBase64, contractText, jobId, contractType } = JSON.parse(event.body || '{}'));
  } catch (e) {
    return json(400, { success: false, error: 'Malformed request body.' });
  }

  if (!jobId) return json(400, { success: false, error: 'Missing job id.' });

  // A client that sends no contractType is a CRNA client, which is what every
  // caller written before travel nursing existed is.
  const profession = normaliseProfession(contractType);
  const profile = profileFor(profession);
  const RUBRIC = profile.rubric;

  // Belt and braces. rubrics.js already returned the rubric for this
  // profession, but a rubric that does not declare it grades this type must not
  // grade it anyway. This is what kept travel RN contracts ungraded rather than
  // graded wrongly before the RN rubric existed.
  if (!rubricApplies(RUBRIC, profession)) {
    await finish(jobId, { score: null, rubric_version: null });
    return json(200, { success: true, skipped: 'no rubric applies to ' + profession });
  }

  const hasPdf = typeof pdfBase64 === 'string' && pdfBase64.length > 0;
  const hasText = typeof contractText === 'string' && contractText.trim().length > 0;
  if (!hasPdf && !hasText) {
    return json(400, { success: false, error: 'No contract file was received.' });
  }

  const docNoun = profession === 'travel_rn'
    ? 'travel nursing assignment contract' : 'contract';

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      // Do NOT set temperature or top_p here. This model rejects them with
      // HTTP 400 "`temperature` is deprecated for this model", and because the
      // whole call is inside one try/catch, that 400 killed every extraction —
      // the row still completed with a prose review, so the only visible
      // symptom was the negotiation report never arriving.
      //
      // Determinism has to come from the prompt and the schema instead: the
      // general-rule-over-carve-out precedence rule, the verbatim quote
      // requirement, and giving every clause a field of its own so the model
      // is never forced to choose which one to record.
      system: systemPromptFor(profession),
      messages: [{
        role: 'user',
        content: hasPdf
          ? [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
              { type: 'text', text: 'Extract the fields described in your instructions from this ' + docNoun + '. Return the JSON and nothing else.' }
            ]
          : [
              { type: 'text', text: 'Here is the full text of a ' + docNoun + ', extracted from a Word document. Table rows are separated by the | character.\n\n<contract>\n'
                  + contractText.trim()
                  + '\n</contract>\n\nExtract the fields described in your instructions. Return the JSON and nothing else.' }
            ]
      }]
    });

    let text = (message.content || [])
      .filter(function (b) { return b.type === 'text'; })
      .map(function (b) { return b.text; })
      .join('')
      .trim();

    text = text.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '');
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first !== -1 && last > first) text = text.slice(first, last + 1);
    text = text.replace(/,(\s*[}\]])/g, '$1');

    let extracted;
    try {
      extracted = JSON.parse(text);
    } catch (e) {
      console.error('Extraction JSON parse failed. profession=' + profession
                    + ' stop_reason=' + message.stop_reason + ' len=' + text.length);
      await finish(jobId, { extraction_error: 'Could not read structured terms from this document.' });
      return json(200, { success: false });
    }

    const score = scoreContract(extracted, RUBRIC);
    score.rate = normaliseRate(extracted, profession);
    // Rate gets its own A-F band, shown beside the offer grade but never folded
    // into it. Without this the analyzer renders a rate with no letter.
    score.rate.band = gradeRate(score.rate.hourly, RUBRIC);
    score.rate.label = profile.rateLabel;

    // Same column set as before this change. contract_type is already on the
    // row, written by the uploader, so the profession is recorded without a
    // schema change and without a second source of truth.
    await finish(jobId, {
      extracted: extracted,
      score: score,
      rubric_version: RUBRIC.version
    });

    await recordObservation(extracted, score, RUBRIC);

    return json(200, { success: true, letter: score.overall.letter, profession: profession });

  } catch (error) {
    // "The term extraction failed to run." told us nothing. An Anthropic SDK
    // error carries the useful part in .status and .error, not .message, so
    // both were being discarded. Log everything, and store a short version on
    // the row so the cause is visible from SQL without digging through logs.
    const status = error && (error.status || error.statusCode);
    const apiMsg = error && error.error && error.error.error && error.error.error.message;
    const detail = [
      status ? 'HTTP ' + status : null,
      apiMsg || (error && error.message) || String(error),
      error && error.type ? '(' + error.type + ')' : null
    ].filter(Boolean).join(' — ');

    console.error('Extraction error:', detail);
    console.error('Extraction error full:', JSON.stringify({
      name: error && error.name,
      status: status,
      type: error && error.type,
      message: error && error.message,
      body: error && error.error
    }));

    await finish(jobId, {
      extraction_error: 'Extraction failed: ' + String(detail).slice(0, 300)
    });
    return json(200, { success: false });
  }
};
