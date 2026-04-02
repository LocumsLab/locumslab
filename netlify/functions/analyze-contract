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

    const prompt = `You are a contract analysis assistant for healthcare locums professionals. Analyze this locums contract and provide a structured first-pass review.

Focus on:
1. Restrictive covenants and non-competes
2. Tail malpractice coverage
3. Termination and cancellation language
4. Payment terms
5. Auto-renewal clauses
6. Vague or ambiguous language
7. Housing, travel, CME, credentialing
8. Call burden, rate differentials, overtime

For each issue provide: quote, title, bucket, severity, finding, whyItMatters, whatToAsk, recommendation.

Return ONLY valid JSON in this format (no markdown):
{
  "riskLevel": "Low|Medium|High",
  "issues": [{
    "quote": "exact clause",
    "title": "Issue name",
    "bucket": "Financial|Restriction|Ambiguity|Termination",
    "severity": "Low|Medium|High",
    "finding": "Plain language",
    "whyItMatters": "Why this matters",
    "whatToAsk": "Question for recruiter",
    "recommendation": "What to do"
  }],
  "missingTerms": ["Missing item 1"],
  "severityBuckets": {"financial": 0, "restriction": 0, "ambiguity": 0, "termination": 0},
  "summary": "Brief summary",
  "recruiterQuestions": ["Question 1"],
  "takeToAttorney": ["Issue 1"]
}`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
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

    const text = message.content[0].text;
    let analysis;
    
    try {
      analysis = JSON.parse(text);
    } catch (e) {
      const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/) || text.match(/(\{[\s\S]*\})/);
      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error('Failed to parse analysis');
      }
    }
    
    if (!analysis.riskLevel) analysis.riskLevel = 'Medium';
    if (!Array.isArray(analysis.issues)) analysis.issues = [];
    if (!Array.isArray(analysis.missingTerms)) analysis.missingTerms = [];
    if (!analysis.severityBuckets) {
      analysis.severityBuckets = { financial: 0, restriction: 0, ambiguity: 0, termination: 0 };
    }
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, analysis: analysis })
    };
    
  } catch (error) {
    console.error('Contract analysis error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Analysis failed' })
    };
  }
};
