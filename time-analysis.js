// time-analysis.js
//
// Measures how long the contract review actually takes, outside Netlify's
// timeout. Run this from your repo root where @anthropic-ai/sdk is installed.
//
//   export ANTHROPIC_API_KEY=sk-ant-...
//   node time-analysis.js path/to/contract.docx
//   node time-analysis.js path/to/contract.pdf
//
// It prints elapsed seconds and token counts so you can tell whether the
// 26-second synchronous ceiling is enough or whether you need a background
// function.

const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

// Keep this identical to the deployed function so the timing is meaningful.
const MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 8000;

const SYSTEM_PROMPT = fs.existsSync('netlify/functions/analyze-contract.js')
  ? (function () {
      const src = fs.readFileSync('netlify/functions/analyze-contract.js', 'utf8');
      const m = src.match(/const SYSTEM_PROMPT = `([\s\S]*?)`;/);
      if (!m) {
        console.error('Could not read SYSTEM_PROMPT from the function. Aborting so timing stays accurate.');
        process.exit(1);
      }
      return m[1];
    })()
  : (function () {
      console.error('Run this from your repo root so it can read netlify/functions/analyze-contract.js');
      process.exit(1);
    })();

async function buildContent(file) {
  const ext = path.extname(file).toLowerCase();

  if (ext === '.pdf') {
    return [
      {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: fs.readFileSync(file).toString('base64')
        }
      },
      {
        type: 'text',
        text: 'Review this contract and return the JSON described in your instructions. Nothing else.'
      }
    ];
  }

  if (ext === '.docx') {
    let mammoth;
    try {
      mammoth = require('mammoth');
    } catch (e) {
      console.error('Install mammoth first:  npm install mammoth');
      process.exit(1);
    }
    const html = (await mammoth.convertToHtml({ path: file })).value || '';
    const text = html
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
      .replace(/<\/t[dh]>/gi, '  |  ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    console.log('Extracted characters:', text.length);
    return [{
      type: 'text',
      text: 'Here is the full text of a contract, extracted from a Word document. '
        + 'Table rows are separated by the | character.\n\n<contract>\n'
        + text
        + '\n</contract>\n\nReview it and return the JSON described in your instructions. Nothing else.'
    }];
  }

  console.error('Pass a .pdf or .docx file.');
  process.exit(1);
}

(async function () {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) {
    console.error('Usage: node time-analysis.js path/to/contract.(pdf|docx)');
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Set ANTHROPIC_API_KEY first.');
    process.exit(1);
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const content = await buildContent(file);

  console.log('Model:', MODEL, '| max_tokens:', MAX_TOKENS);
  console.log('Calling API...\n');

  const started = Date.now();
  let message;
  try {
    message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: content }]
    });
  } catch (err) {
    console.error('API error after', ((Date.now() - started) / 1000).toFixed(1) + 's:', err.message);
    process.exit(1);
  }
  const elapsed = (Date.now() - started) / 1000;

  const text = (message.content || [])
    .filter(function (b) { return b.type === 'text'; })
    .map(function (b) { return b.text; })
    .join('');

  console.log('===================================');
  console.log('ELAPSED:        ' + elapsed.toFixed(1) + ' seconds');
  console.log('input tokens:   ' + message.usage.input_tokens);
  console.log('output tokens:  ' + message.usage.output_tokens);
  console.log('stop_reason:    ' + message.stop_reason);
  console.log('response chars: ' + text.length);
  console.log('===================================');

  if (message.stop_reason === 'max_tokens') {
    console.log('\nWARNING: hit max_tokens. The JSON is truncated and will fail to parse.');
  }

  let parsed = null;
  try {
    const t = text.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '');
    parsed = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
    console.log('\nJSON parsed OK.');
    console.log('riskLevel:      ' + parsed.riskLevel);
    console.log('issues:         ' + (parsed.issues || []).length);
    console.log('missingTerms:   ' + (parsed.missingTerms || []).length);
    console.log('buckets:        ' + JSON.stringify(parsed.severityBuckets));
  } catch (e) {
    console.log('\nJSON FAILED TO PARSE.');
  }

  console.log('\nVERDICT:');
  if (elapsed < 20) {
    console.log('  Fits inside a 26s synchronous timeout with margin. The toml patch is enough.');
  } else if (elapsed < 26) {
    console.log('  Fits inside 26s but with little margin. A longer contract will fail.');
    console.log('  Consider the background function.');
  } else {
    console.log('  Exceeds the 26s synchronous ceiling. You need a background function.');
  }
  console.log('  (Run this on 2-3 contracts of different lengths before deciding.)');
})();
