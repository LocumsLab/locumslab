const Anthropic = require('@anthropic-ai/sdk');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    const { pdfBase64, filename } = JSON.parse(event.body);
    
    if (!pdfBase64) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'No PDF provided' })
      };
    }

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const prompt = `Review this contract for a CRNA. List the top 3-5 concerns. For each concern provide: the exact quote, why it matters, and what to ask the recruiter.

Return as valid JSON with NO other text:
{
  "concerns": [
    {
      "quote": "exact contract text",
      "issue": "what's wrong",
      "question": "what to ask recruiter"
    }
  ],
  "summary": "1-2 sentence overall assessment"
}`;

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,  // Shorter = more reliable JSON
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBase64
            }
          },
          {
            type: 'text',
            text: prompt
          }
        ]
      }]
    });

    let text = message.content[0].text.trim();
    
    // Aggressive cleaning
    text = text.replace(/^[^{]*/, '');
    text = text.replace(/[^}]*$/, '');
    text = text.replace(/```[a-z]*\n?/g, '');
    text = text.replace(/,(\s*[}\]])/g, '$1');
    
    let simple;
    try {
      simple = JSON.parse(text);
    } catch (e) {
      simple = {
        concerns: [{
          quote: "Analysis parsing failed",
          issue: "Unable to automatically analyze contract format",
          question: "Please have a CRNA colleague or attorney review this contract"
        }],
        summary: "Contract uploaded successfully but automated analysis could not complete. Manual review recommended."
      };
    }
    
    // Convert simple format to full format
    const analysis = {
      riskLevel: simple.concerns && simple.concerns.length > 3 ? 'High' : simple.concerns && simple.concerns.length > 1 ? 'Medium' : 'Low',
      issues: (simple.concerns || []).map((c, i) => ({
        quote: c.quote || '',
        title: c.issue || 'Concern ' + (i+1),
        bucket: 'Financial',
        severity: i === 0 ? 'High' : 'Medium',
        finding: c.issue || '',
        whyItMatters: c.issue || '',
        whatToAsk: c.question || '',
        recommendation: 'Discuss with recruiter'
      })),
      missingTerms: [],
      severityBuckets: {
        financial: Math.min((simple.concerns || []).length, 3),
        restriction: 0,
        ambiguity: 0,
        termination: 0
      },
      summary: simple.summary || 'Contract review completed',
      recruiterQuestions: (simple.concerns || []).map(c => c.question).filter(Boolean),
      takeToAttorney: simple.concerns && simple.concerns.length > 2 ? ['Review all flagged items with attorney'] : []
    };
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, analysis: analysis })
    };
    
  } catch (error) {
    console.error('Analysis error:', error.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Analysis failed' })
    };
  }
};
