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

    // Shorter, focused prompt for faster response
    const prompt = `Analyze this locums contract and provide a concise first-pass review.

Focus on the TOP issues only:
1. Non-competes and restrictive covenants
2. Tail malpractice coverage and cost responsibility
3. Termination language and notice periods
4. Payment terms and timing
5. Missing critical terms

For each issue: quote the exact clause, explain why it matters, what to ask.

Return ONLY valid JSON (no markdown):
{
  "riskLevel": "Low|Medium|High",
  "issues": [{
    "quote": "exact clause",
    "title": "Issue name",
    "bucket": "Financial|Restriction|Ambiguity|Termination",
    "severity": "Low|Medium|High",
    "finding": "What it says",
    "whyItMatters": "Why this matters",
    "whatToAsk": "Question for recruiter",
    "recommendation": "What to do"
  }],
  "missingTerms": ["Critical missing item"],
  "severityBuckets": {"financial": 0, "restriction": 0, "ambiguity": 0, "termination": 0},
  "summary": "2-3 sentence summary",
  "recruiterQuestions": ["Top question"],
  "takeToAttorney": ["Critical issue for lawyer"]
}

Keep it concise - focus on what matters most.`;

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-20250514',  // Fast model
      max_tokens: 2000,  // Concise response = under 10 seconds
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
    
    // Ensure required fields exist
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
      body: JSON.stringify({ 
        success: false, 
        error: 'Analysis failed. Please try again.' 
      })
    };
  }
};
