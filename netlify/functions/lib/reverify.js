/* LocumsLab — © 2026 LocumsLab. All rights reserved.
 * LocumsLab™ is a trademark of LocumsLab.
 */
// Targeted re-verification.
//
// The first extraction reads thirty-odd fields across a whole contract. A small
// number come back doubtful: the quote cannot be found in the document, or the
// model flagged the language ambiguous or conflicting. Re-reading the entire
// contract to fix three fields is wasteful and reintroduces variance in the
// thirty that were already fine.
//
// So this asks one narrow question instead: here are the specific fields that
// did not resolve, here is what the first pass claimed, tell me which provision
// actually controls. One extra call, only on a cache miss, only when something
// is genuinely unresolved.
//
// Two rules make this safe:
//
//   1. It can only touch the fields handed to it. Everything else is untouched,
//      so re-verification cannot perturb a field that was already confirmed.
//   2. Its answers go through the same evidence validation as the first pass.
//      A second hallucinated quote does not get a free pass because it came
//      from the verifier.

const ctext = require('./contract-text');

const REVERIFY_SYSTEM = `You are re-examining specific terms in a contract that a first pass could not establish. You do not evaluate, grade, rank, or advise. You report only what the document says.

You will be given the contract, and a list of fields with what the first pass claimed and why it was doubted. For EACH field, decide what the contract actually says.

Return ONLY valid JSON, no preamble and no markdown fences, shaped exactly like this:

{ "<field_name>": { "value": <typed value or null>, "quote": "<verbatim contract text, at most 40 words>", "certainty": "explicit" | "ambiguous" | "conflicting", "reasoning": "<one sentence on which provision controls and why>" } }

Rules:
- Include every field you were asked about and no others.
- The quote must be copied VERBATIM from the contract. If you cannot find text that supports your value, the value is null. A field the first pass got wrong is better left unresolved than replaced with another guess.
- Where several provisions address the field, identify which one CONTROLS: the general rule governs, an exception or carve-out does not. Quote the controlling provision.
- Where two provisions genuinely conflict and neither clearly controls, set value to null and certainty to "conflicting", and quote the provision that creates the conflict.
- Where the contract does not address the field at all, set value to null and certainty to "explicit". Silence is a real finding.
- Use the SAME value types and enums the first pass was given. Do not invent categories.
- Do not repeat the first pass's claim back unless the contract actually supports it. You were called because it was doubtful.`;

// Which fields need another look, and why. Ordered so the reason is visible in
// the prompt and in the logs.
function fieldsNeedingReview(extracted, rubric) {
  const out = [];
  Object.keys(extracted || {}).forEach(function (key) {
    const f = extracted[key];
    if (!f || typeof f !== 'object' || Array.isArray(f)) return;

    let reason = null;
    if (f.evidence_rejected) {
      reason = 'the quote given could not be found in the contract';
    } else if (f.certainty === 'conflicting') {
      reason = 'the first pass saw provisions that disagree';
    } else if (f.certainty === 'ambiguous') {
      reason = 'the first pass could not determine the effect of the language';
    }
    if (!reason) return;

    out.push({
      key: key,
      reason: reason,
      claimedValue: f.value === undefined ? null : f.value,
      claimedQuote: typeof f.quote === 'string' ? f.quote : ''
    });
  });

  // High-leverage fields first, so a truncated response resolves what matters.
  const weightOf = function (k) {
    const fields = (rubric && rubric.fields) || {};
    if (fields[k]) return fields[k].possible || 0;
    let best = 0;
    Object.keys(fields).forEach(function (fk) {
      const reads = fields[fk].reads || {};
      Object.keys(reads).forEach(function (role) {
        if (reads[role] === k) best = Math.max(best, fields[fk].possible || 0);
      });
    });
    return best;
  };
  out.sort(function (a, b) { return weightOf(b.key) - weightOf(a.key); });
  return out;
}

function buildUserMessage(contractText, pending) {
  const list = pending.map(function (p, i) {
    return (i + 1) + '. ' + p.key
      + '\n   First pass said: ' + JSON.stringify(p.claimedValue)
      + '\n   Doubted because: ' + p.reason
      + (p.claimedQuote ? '\n   Quote it gave: "' + p.claimedQuote + '"' : '');
  }).join('\n\n');

  return 'Here is the contract.\n\n<contract>\n' + contractText.trim() + '\n</contract>\n\n'
    + 'Re-examine ONLY these ' + pending.length + ' field'
    + (pending.length === 1 ? '' : 's') + ':\n\n' + list
    + '\n\nReturn the JSON and nothing else.';
}

function parseJson(raw) {
  let t = String(raw || '').replace(/```[a-z]*\n?/gi, '').replace(/```/g, '');
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first !== -1 && last > first) t = t.slice(first, last + 1);
  t = t.replace(/,(\s*[}\]])/g, '$1');
  try { return JSON.parse(t); } catch (e) { return null; }
}

// Returns a report; the caller decides what to write. Never throws — a failed
// re-verification leaves the fields exactly as the first pass left them, which
// is the already-correct "unresolved" state.
async function reverify(opts) {
  const { anthropic, model, extracted, rubric, contractText, systemContext } = opts;

  const pending = fieldsNeedingReview(extracted, rubric);
  if (!pending.length) {
    return { ran: false, pending: [], resolved: [], stillUnresolved: [] };
  }
  if (!contractText || !contractText.trim()) {
    // No text to re-read. Nothing to do but leave them unresolved.
    return { ran: false, pending: pending.map(function (p) { return p.key; }),
             resolved: [], stillUnresolved: pending.map(function (p) { return p.key; }),
             skipped: 'no contract text' };
  }

  const resolved = [];
  const stillUnresolved = [];

  try {
    const message = await anthropic.messages.create({
      model: model,
      max_tokens: 4000,
      // The original extraction prompt is appended so the field definitions and
      // enums are identical to the first pass. Re-verification that uses
      // different definitions would trade one inconsistency for another.
      system: REVERIFY_SYSTEM + '\n\n---\n\nField definitions, unchanged from the first pass:\n\n'
              + (systemContext || ''),
      messages: [{ role: 'user', content: buildUserMessage(contractText, pending) }]
    });

    const raw = (message.content || [])
      .filter(function (b) { return b.type === 'text'; })
      .map(function (b) { return b.text; })
      .join('');

    const answer = parseJson(raw);
    if (!answer) {
      console.error('Re-verification returned unparseable JSON. stop_reason=' + message.stop_reason);
      return { ran: true, parseFailed: true, pending: pending.map(function (p) { return p.key; }),
               resolved: [], stillUnresolved: pending.map(function (p) { return p.key; }) };
    }

    const src = ctext.matchForm(ctext.normaliseContractText(contractText));

    pending.forEach(function (p) {
      const a = answer[p.key];
      if (!a || typeof a !== 'object') { stillUnresolved.push(p.key); return; }

      const value = a.value === undefined ? null : a.value;
      const quote = typeof a.quote === 'string' ? a.quote : '';
      const certainty = a.certainty;

      // The verifier decided the contract is silent. That is a real finding and
      // resolves the field: null with a clean certainty routes to the existing
      // silence rule rather than staying flagged as unverified.
      if (value === null && certainty === 'explicit') {
        extracted[p.key] = { value: null, quote: '', certainty: 'explicit' };
        delete extracted[p.key].evidence_rejected;
        resolved.push({ key: p.key, outcome: 'confirmed silent' });
        return;
      }

      // Still cannot tell. Leave it unresolved — it stays in the denominator at
      // zero and surfaces as needing clarification, which is the honest answer.
      if (value === null) { stillUnresolved.push(p.key); return; }

      // Same evidence bar as the first pass. A second unsupported quote does
      // not become fact because a second call produced it.
      const check = ctext.validateEvidence(quote, src);
      if (check.checked && !check.valid) {
        stillUnresolved.push(p.key);
        console.warn('Re-verification of ' + p.key + ' returned an unverifiable quote; left unresolved.');
        return;
      }

      extracted[p.key] = { value: value, quote: quote, certainty: certainty || 'explicit' };
      resolved.push({
        key: p.key,
        outcome: 'resolved',
        changed: JSON.stringify(value) !== JSON.stringify(p.claimedValue),
        reasoning: typeof a.reasoning === 'string' ? a.reasoning : ''
      });
    });

    // Anything still doubtful keeps its flag so scoreContract treats it as
    // unresolved rather than scoring it.
    stillUnresolved.forEach(function (k) {
      if (extracted[k] && typeof extracted[k] === 'object') extracted[k].evidence_rejected = true;
    });

    return {
      ran: true,
      pending: pending.map(function (p) { return p.key; }),
      resolved: resolved,
      stillUnresolved: stillUnresolved
    };

  } catch (e) {
    console.error('Re-verification failed:', e && e.message);
    return { ran: true, error: (e && e.message) || String(e),
             pending: pending.map(function (p) { return p.key; }),
             resolved: [], stillUnresolved: pending.map(function (p) { return p.key; }) };
  }
}

module.exports = { reverify, fieldsNeedingReview, REVERIFY_SYSTEM };
