const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-sonnet-5';

const SYSTEM_PROMPT = `You are reviewing a locum tenens contract on behalf of a CRNA who is deciding whether to sign it. You are not their attorney and you do not give legal advice. Your job is to make the contract legible: say what it actually says, flag what is missing, and give them precise questions to ask.

Review these categories specifically:
- Restrictive covenants: non-compete, non-solicitation, and how long they last and where they apply
- Malpractice: who provides coverage, claims-made vs occurrence, and who pays for tail
- Termination and cancellation: notice period on each side, whether the facility can cancel shifts, and any penalty
- Guaranteed hours: whether hours are actually guaranteed, and what happens on a facility cancellation or low census
- Payment: rate, overtime, call and callback pay, invoice timing, and how quickly they pay
- Expenses: travel, housing, mileage, meals, licensing, DEA, and credentialing, and who bears each
- Auto-renewal, indemnification, and repayment obligations

Be specific and quote the contract directly. Do not pad. If a contract is genuinely clean, say so rather than inventing concerns.

Return ONLY valid JSON, no preamble, no markdown fences, matching this shape exactly:

{
  "riskLevel": "Low" | "Medium" | "High",
  "summary": "2-3 sentences on the overall picture, written to the CRNA",
  "issues": [
    {
      "title": "Short name for the issue",
      "bucket": "Financial" | "Restriction" | "Ambiguity" | "Termination",
      "severity": "Low" | "Medium" | "High",
      "quote": "Exact text from the contract. Empty string if the issue is that something is absent.",
      "finding": "What the clause actually says, in plain language",
      "whyItMatters": "The practical consequence for the CRNA. Must be different from finding.",
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

Rules:
- riskLevel reflects the severity of the worst issues, never the number of issues. A single unbounded non-compete or an uncovered tail is High on its own.
- severityBuckets are 0 to 3 per category: 0 nothing flagged, 1 worth watching, 2 moderate, 3 serious.
- Every bucket value must be justified by the issues you listed.
- finding and whyItMatters must say different things.
- Write recommendations specific to the clause, never a generic instruction.`;

exports.handler = async (event) => {
  const json = (statusCode, payload) => ({
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (event.httpMethod !== 'POST') {
    return json(405, { success: false, error: 'Method Not Allowed' });
  }

  let pdfBase64, contractText, filename;
  try {
    ({ pdfBase64, contractText, filename } = JSON.parse(event.body || '{}'));
  } catch (e) {
    return json(400, { success: false, error: 'Malformed request body.' });
  }

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
              {
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 }
              },
              {
                type: 'text',
                text: 'Review this contract and return the JSON described in your instructions. Nothing else.'
              }
            ]
          : [
              {
                type: 'text',
                text: 'Here is the full text of a contract, extracted from a Word document. Table rows are separated by the | character.\n\n<contract>\n'
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
    } catch (e) {
      // Do NOT fake a successful review. The client shows this message.
      console.error('JSON parse failed. stop_reason=' + message.stop_reason + ' len=' + text.length);
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
    console.error('Analysis error:', error && error.message, 'file:', filename);
    return json(500, {
      success: false,
      error: 'The contract review failed to run. Please try again, or email hello@locumslab.com.'
    });
  }
};
