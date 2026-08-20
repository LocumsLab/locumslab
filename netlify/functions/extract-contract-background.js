const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const { scoreContract } = require('./lib/score-contract');
const RUBRIC = require('./lib/rubric-v1.json');

// Additive. This does NOT replace analyze-contract-background.js. It writes to
// new columns (extracted, score, rubric_version) on the same contract_reviews
// row, so both paths can run against the same contract and be compared before
// anything switches over.
//
// The model's only job here is extraction. It never sees the rubric, never
// assigns a grade, and never writes prose. Grading happens in score-contract.js
// so the same contract always produces the same letter.
//
// Required env: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const MODEL = 'claude-sonnet-5';

const SYSTEM_PROMPT = `You extract structured facts from locum tenens contracts. You do not evaluate, grade, rank, or advise. You report only what the document says.

Return ONLY valid JSON, no preamble and no markdown fences. Every key below must be present. Each value is an object:

{ "value": <typed value or null>, "quote": "<verbatim contract text, at most 30 words>" }

THE MOST IMPORTANT RULE: if the contract does not address a term, set "value" to null and "quote" to "". Do not infer, do not assume a market default, and do not treat an absence as an unfavorable value. Silence and an unfavorable stated term are different findings and are handled differently downstream.

Where a numeric field is explicitly stated as absent (for example, the contract says hours are not guaranteed), use the string "none" rather than null. Use null only when the document is silent.

Fields and their types:

IDENTIFIERS AND CONTEXT
base_hourly_rate: number
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
- Never derive a value by calculation. If the contract states a per-shift or per-diem rate, leave base_hourly_rate null rather than dividing by shift length.
- A non-null value REQUIRES a verbatim quote. If you cannot quote text supporting the value, the value is null. This applies especially to "none": only use it where the contract affirmatively says the term does not apply.
- If you find language relevant to a field but it does not fit the required type, set value to null and still put the language in "quote".
- unilateral_scope_change is true only where the contract grants that right in the text.
- Every quote must be copied verbatim from the contract. Never paraphrase inside a quote. If a value comes from a table, quote the row.`;

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });
}

async function finish(jobId, patch) {
  if (!jobId) return;
  try {
    await db().from('contract_reviews').update(patch).eq('id', jobId);
  } catch (e) {
    console.error('Failed writing extraction result:', e && e.message);
  }
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
async function recordObservation(extracted, score) {
  try {
    const row = { rubric_version: RUBRIC.version, observed_month: new Date().toISOString().slice(0, 7) + '-01' };

    (RUBRIC.marketObservationFields || []).forEach(function (key) {
      const raw = extracted[key];
      const v = raw && typeof raw === 'object' ? raw.value : raw;
      row[key] = v === undefined ? null : v;
    });

    const rate = extracted.base_hourly_rate;
    row.rate_band = rateBand(rate && typeof rate === 'object' ? rate.value : rate);
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

  // The rubric is calibrated on CRNA locums terms. Grading a travel RN
  // contract against it would produce confident, wrong letters.
  const type = contractType || 'crna_locums';
  if ((RUBRIC.appliesTo || []).indexOf(type) === -1) {
    await finish(jobId, { score: null, rubric_version: null });
    return json(200, { success: true, skipped: 'rubric does not apply to ' + type });
  }

  const hasPdf = typeof pdfBase64 === 'string' && pdfBase64.length > 0;
  const hasText = typeof contractText === 'string' && contractText.trim().length > 0;
  if (!hasPdf && !hasText) {
    return json(400, { success: false, error: 'No contract file was received.' });
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: hasPdf
          ? [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
              { type: 'text', text: 'Extract the fields described in your instructions from this contract. Return the JSON and nothing else.' }
            ]
          : [
              { type: 'text', text: 'Here is the full text of a contract, extracted from a Word document. Table rows are separated by the | character.\n\n<contract>\n'
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
      console.error('Extraction JSON parse failed. stop_reason=' + message.stop_reason + ' len=' + text.length);
      await finish(jobId, { extraction_error: 'Could not read structured terms from this document.' });
      return json(200, { success: false });
    }

    const score = scoreContract(extracted, RUBRIC);

    await finish(jobId, {
      extracted: extracted,
      score: score,
      rubric_version: RUBRIC.version
    });

    await recordObservation(extracted, score);

    return json(200, { success: true, letter: score.overall.letter });

  } catch (error) {
    console.error('Extraction error:', error && error.message);
    await finish(jobId, { extraction_error: 'The term extraction failed to run.' });
    return json(200, { success: false });
  }
};
