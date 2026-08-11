const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-sonnet-5';

// Shared across both contract types. Keeping the schema identical means the
// client's normalizeContractAnalysis and rendering code need no changes.
const OUTPUT_CONTRACT = `Return ONLY valid JSON, no preamble, no markdown fences, matching this shape exactly:

{
  "riskLevel": "Low" | "Medium" | "High",
  "summary": "2-3 sentences on the overall picture, written to the reader",
  "issues": [
    {
      "title": "Short name for the issue",
      "bucket": "Financial" | "Restriction" | "Ambiguity" | "Termination",
      "severity": "Low" | "Medium" | "High",
      "quote": "Exact text from the contract. Empty string if the issue is that something is absent.",
      "finding": "What the clause actually says, in plain language",
      "whyItMatters": "The practical consequence for the reader. Must be different from finding.",
      "whatToAsk": "One specific question to send the recruiter",
      "recommendation": "The concrete next step for this issue"
    }
  ],
  "missingTerms": [
    "Each item is a specific term the contract does not address or leaves ambiguous"
  ],
  "severityBuckets": {
    "financial": 0-3,
    "restriction": 0-3,
    "ambiguity": 0-3,
    "termination": 0-3
  },
  "recruiterQuestions": ["3-6 specific questions, each answerable by the recruiter"],
  "takeToAttorney": ["Only items that genuinely warrant a lawyer. Empty array if none do."]
}

Length limits. Exceeding these truncates the response and the whole review is lost, so stay inside them:
- At most 6 issues. Choose the 6 that most affect the reader's decision.
- Each "quote" at most 40 words. Quote only the operative sentence, not the full clause. If the clause is long, quote the key phrase and summarise the rest in "finding".
- "finding", "whyItMatters", "whatToAsk", and "recommendation" are each at most 2 sentences.
- At most 8 missingTerms, one line each.
- At most 6 recruiterQuestions, one sentence each.
- At most 4 takeToAttorney items.

Rules:
- riskLevel is High if any issue is High, Medium if the worst is Medium, otherwise Low. It never reflects the number of issues.
- severityBuckets are derived mechanically, not judged separately. For each category, the value is the highest severity among the issues you assigned to that bucket: 0 if you listed none, 1 if the worst is Low, 2 if the worst is Medium, 3 if the worst is High. Do not adjust these for overall impression.
- finding and whyItMatters must say different things.
- Write recommendations specific to the clause, never a generic instruction.
- Judge only what the document says. Do not infer terms from what is typical for these contracts.
- List issues by severity, High first, then Medium, then Low. Within the same severity, follow the category order given above.`;

const CRNA_PROMPT = `You are reviewing a locum tenens contract on behalf of a CRNA who is deciding whether to sign it. You are not their attorney and you do not give legal advice. Your job is to make the contract legible: say what it actually says, flag what is missing, and give them precise questions to ask.

Review these categories specifically, in this order:
- Restrictive covenants: non-compete, non-solicitation, and how long they last and where they apply
- Malpractice: who provides coverage, claims-made vs occurrence, and who pays for tail
- Termination and cancellation: notice period on each side, whether the facility can cancel shifts, and any penalty
- Guaranteed hours: whether hours are actually guaranteed, and what happens on a facility cancellation or low census
- Payment: rate, overtime, call and callback pay, invoice timing, and how quickly they pay
- Expenses: travel, housing, mileage, meals, licensing, DEA, and credentialing, and who bears each
- Auto-renewal, indemnification, and repayment obligations

Read clauses against each other, not in isolation. A guarantee in one section can be voided by at-will or exception language in another. If a defined term such as "Facility" is written to include affiliates or related entities, a narrow-looking non-compete may cover far more ground than it appears to.

Be specific and quote the contract directly. Do not pad. If a contract is genuinely clean, say so rather than inventing concerns.

Severity rubric. Apply it literally so the same contract always scores the same way:
- High: the clause creates uncapped or unquantifiable exposure, removes a protection the CRNA cannot recover elsewhere, or misstates the scope of practice. Examples: uncovered tail, indemnification triggered by allegation alone, a non-compete with no geographic or time bound, a service description naming the wrong specialty.
- Medium: the clause creates a real but bounded cost, or an important term is absent and negotiable. Examples: no guaranteed hours, no cancellation pay, undefined auto-renewal notice, shared malpractice limits.
- Low: worth knowing before signing but unlikely to change the decision on its own.

` + OUTPUT_CONTRACT;

const TRAVEL_RN_PROMPT = `You are reviewing a travel nursing assignment contract on behalf of the nurse who is deciding whether to sign it. You are not their attorney and you do not give legal advice. Your job is to make the contract legible: say what it actually says, flag what is missing, and give them precise questions to ask their recruiter.

Review these categories specifically, in this order:
- Pay structure: the taxable hourly base, housing and meal stipends stated separately, overtime definition, holiday and on-call rates, and any missed-shift or cancelled-shift penalty
- Guaranteed hours: whether hours are actually guaranteed, and the full exception list that voids the guarantee
- Cancellation and termination: notice required from the facility, notice or penalty required from the nurse, what counts as cause, and whether the facility can cancel shifts or the whole assignment
- Float and scheduling: which units the nurse can be floated to, whether specific units are named, charge duty, shift patterns, self-cancel policy, and whether declining a float is treated as cause
- Restrictive covenants: whether the nurse is barred from returning to the facility through another agency, whether there is a permanent-hire conversion fee, and any non-solicitation
- Reimbursement and clawback: license fees, travel allowance, sign-on and completion bonuses, and the conditions under which the agency can recover them
- Professional liability: coverage limits, whether limits are shared or dedicated to the nurse, claims-made vs occurrence, and tail
- Legal mechanics: whether an employee handbook or agency policy manual is incorporated by reference, arbitration and venue, and at-will language

Things specific to travel nursing that you must check for:

1. Wage recharacterization. Stipends are only tax-free if the nurse maintains a legitimate tax home and the taxable base is a reasonable wage for the work. A taxable hourly base that is far below what a staff nurse in that role would earn, paired with large stipends, is the pattern the IRS treats as disguised wages. If the base looks artificially low relative to the total package, flag it as a Financial issue, reference Rev. Rul. 2006-56, and note that the back-tax exposure falls on the nurse, not the agency. Do not state a specific dollar threshold as a rule; describe the pattern.

2. Guaranteed hours that do not survive the rest of the document. Do not simply report that a guarantee exists. Find the exception list, find any at-will clause elsewhere in the contract, and say whether the guarantee actually holds. If the contract touts guaranteed hours while permitting the facility to cancel shifts, that contradiction is the issue.

3. The Confirmation. Many travel contracts reference a separate confirmation or assignment sheet between the agency and the facility. Verbal agreements made during the interview, such as specific days off or unit restrictions, are only enforceable if they appear there. If the contract references a confirmation that is not included in what you were given, flag it under Ambiguity.

4. Incorporation by reference. If an employee handbook, policy manual, or agency guidelines document is incorporated by reference, the nurse is bound by terms they have not read and that the agency can change. Flag it.

5. Absence as a finding. If guaranteed hours, float scope, cancellation notice, on-call rate, or the stipend breakdown are not specified at all, that absence is itself an issue. Set "quote" to an empty string and say plainly that the term is not addressed.

Read clauses against each other, not in isolation. If a defined term such as "Facility" is written to include affiliates or related entities, a float clause or a non-compete may cover far more ground than it appears to.

Be specific and quote the contract directly. Do not pad. If a contract is genuinely clean, say so rather than inventing concerns.

Severity rubric. Apply it literally so the same contract always scores the same way:
- High: the clause creates uncapped or unquantifiable exposure, removes a protection the nurse cannot recover elsewhere, or creates tax exposure the nurse carries personally. Examples: a taxable base so low it invites recharacterization, guaranteed hours voided by an at-will clause, clawback that applies even when the facility cancels, unlimited float with no named units, uncovered tail, indemnification triggered by allegation alone.
- Medium: the clause creates a real but bounded cost, or an important term is absent and negotiable. Examples: asymmetric cancellation notice, a completion bonus forfeited on facility cancellation, shared liability limits, handbook incorporated by reference, no on-call rate specified.
- Low: worth knowing before signing but unlikely to change the decision on its own.

` + OUTPUT_CONTRACT;

function promptFor(contractType) {
  return contractType === 'travel_rn' ? TRAVEL_RN_PROMPT : CRNA_PROMPT;
}

// Closes an unterminated JSON object by trimming back to the last complete
// element and appending the brackets the model never got to write. Ported
// from the background function so a long review is not lost outright.
function salvageTruncatedJson(text) {
  if (!text || text.indexOf('{') === -1) return null;

  for (let cut = text.length; cut > 200; cut -= 1) {
    const ch = text[cut - 1];
    if (ch !== '}' && ch !== ']' && ch !== '"') continue;

    let candidate = text.slice(0, cut).replace(/,\s*$/, '');

    let depthCurly = 0, depthSquare = 0, inStr = false, esc = false;
    for (let i = 0; i < candidate.length; i++) {
      const c = candidate[i];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{') depthCurly++;
      else if (c === '}') depthCurly--;
      else if (c === '[') depthSquare++;
      else if (c === ']') depthSquare--;
    }
    if (inStr || depthCurly < 0 || depthSquare < 0) continue;

    let repaired = candidate;
    while (depthSquare-- > 0) repaired += ']';
    while (depthCurly-- > 0) repaired += '}';

    try {
      const obj = JSON.parse(repaired);
      if (obj && typeof obj === 'object') {
        console.log('Salvaged truncated JSON at ' + cut + ' of ' + text.length);
        return obj;
      }
    } catch (e) { /* keep walking back */ }
  }
  return null;
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

  let pdfBase64, contractText, filename, contractType;
  try {
    ({ pdfBase64, contractText, filename, contractType } = JSON.parse(event.body || '{}'));
  } catch (e) {
    return json(400, { success: false, error: 'Malformed request body.' });
  }

  // Anything other than an explicit travel_rn falls back to the CRNA prompt,
  // so an older client that sends no contractType keeps working unchanged.
  const type = contractType === 'travel_rn' ? 'travel_rn' : 'crna_locums';

  // PDFs arrive as base64. Word documents arrive as extracted text, since
  // rebuilding a PDF client-side added nothing and failed on long contracts.
  const hasPdf = typeof pdfBase64 === 'string' && pdfBase64.length > 0;
  const hasText = typeof contractText === 'string' && contractText.trim().length > 0;

  if (!hasPdf && !hasText) {
    return json(400, { success: false, error: 'No contract file was received. Please try uploading again.' });
  }

  if (hasText && contractText.trim().length < 200) {
    return json(400, { success: false, error: 'That document did not contain enough readable text to review. If it is a scan, please upload a text-based PDF instead.' });
  }

  const readerNoun = type === 'travel_rn' ? 'travel nursing assignment contract' : 'contract';

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 16000,
      temperature: 0,
      system: promptFor(type),
      messages: [{
        role: 'user',
        content: hasPdf
          ? [
              {
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 }
              },
              {
                type: 'text',
                text: 'Review this ' + readerNoun + ' and return the JSON described in your instructions. Nothing else.'
              }
            ]
          : [
              {
                type: 'text',
                text: 'Here is the full text of a ' + readerNoun + ', extracted from a Word document. Table rows are separated by the | character.\n\n<contract>\n'
                  + contractText.trim()
                  + '\n</contract>\n\nReview it and return the JSON described in your instructions. Nothing else.'
              }
            ]
      }]
    });

    // Join every text block rather than assuming content[0]
    let text = (message.content || [])
      .filter(function (b) { return b.type === 'text'; })
      .map(function (b) { return b.text; })
      .join('')
      .trim();

    // Strip markdown fences first, then trim to the outermost JSON object
    text = text.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '');
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first !== -1 && last > first) {
      text = text.slice(first, last + 1);
    }
    text = text.replace(/,(\s*[}\]])/g, '$1');

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (eFirst) {
      // If the model ran out of tokens the JSON is cut off mid-object. Close
      // the open structures and salvage whatever complete items came through
      // rather than discarding the whole review.
      parsed = salvageTruncatedJson(text);
    }

    if (!parsed) {
      // Do NOT fake a successful review. The client shows this message.
      console.error('JSON parse failed. type=' + type + ' stop_reason=' + message.stop_reason + ' len=' + text.length);
      return json(502, {
        success: false,
        error: 'The review could not be completed for this document. This usually means the file is a scan without selectable text. Try a text-based PDF, or email hello@locumslab.com and it will be reviewed manually.'
      });
    }

    const VALID_RISK = ['Low', 'Medium', 'High'];
    const VALID_SEV = ['Low', 'Medium', 'High'];
    const VALID_BUCKET = ['Financial', 'Restriction', 'Ambiguity', 'Termination'];

    const clamp = function (n) {
      const v = parseInt(n, 10);
      if (isNaN(v)) return 0;
      return Math.max(0, Math.min(3, v));
    };
    const str = function (v) { return typeof v === 'string' ? v.trim() : ''; };
    const strArr = function (v) {
      return Array.isArray(v) ? v.map(str).filter(Boolean) : [];
    };

    const issues = (Array.isArray(parsed.issues) ? parsed.issues : []).map(function (c, i) {
      const finding = str(c.finding) || str(c.title) || 'See contract language.';
      let why = str(c.whyItMatters);
      if (!why || why === finding) why = '';
      return {
        title: str(c.title) || 'Issue ' + (i + 1),
        bucket: VALID_BUCKET.indexOf(str(c.bucket)) !== -1 ? str(c.bucket) : 'Ambiguity',
        severity: VALID_SEV.indexOf(str(c.severity)) !== -1 ? str(c.severity) : 'Medium',
        quote: str(c.quote),
        finding: finding,
        whyItMatters: why,
        whatToAsk: str(c.whatToAsk),
        recommendation: str(c.recommendation)
      };
    });

    // Derive risk from the worst severity present, not from the count.
    let riskLevel = str(parsed.riskLevel);
    if (VALID_RISK.indexOf(riskLevel) === -1) {
      if (issues.some(function (i) { return i.severity === 'High'; })) riskLevel = 'High';
      else if (issues.length) riskLevel = 'Medium';
      else riskLevel = 'Low';
    }

    const sb = parsed.severityBuckets || {};
    const missing = strArr(parsed.missingTerms);

    const analysis = {
      contractType: type,
      riskLevel: riskLevel,
      summary: str(parsed.summary) || 'Review completed. See the issues below.',
      issues: issues,
      missingTerms: missing,
      missingItems: missing,
      severityBuckets: {
        financial: clamp(sb.financial),
        restriction: clamp(sb.restriction),
        ambiguity: clamp(sb.ambiguity),
        termination: clamp(sb.termination)
      },
      recruiterQuestions: strArr(parsed.recruiterQuestions),
      takeToAttorney: strArr(parsed.takeToAttorney),
      attorneyItems: strArr(parsed.takeToAttorney)
    };

    return json(200, { success: true, analysis: analysis });

  } catch (error) {
    console.error('Analysis error:', error && error.message, 'type:', type, 'file:', filename);
    return json(500, {
      success: false,
      error: 'The contract review failed to run. Please try again, or email hello@locumslab.com.'
    });
  }
};
