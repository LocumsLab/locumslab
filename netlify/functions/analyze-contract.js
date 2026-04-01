const Anthropic = require('@anthropic-ai/sdk');

exports.handler = async (event) => {
  // Only allow POST requests
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

    // Initialize Anthropic client with secret key from environment
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    // Enhanced prompt matching ChatGPT's spec
    const prompt = `You are a contract analysis assistant for healthcare locums professionals (CRNAs, physicians, NPs, PAs). Analyze this locums contract and provide a structured first-pass review.

Focus on these key areas:
1. **Restrictive covenants and non-competes** - especially in states where unenforceable
2. **Tail malpractice coverage** - who pays, cost responsibility, claims-made vs occurrence
3. **Termination and cancellation language** - notice periods, penalties, cause vs without-cause
4. **Payment terms** - timing, invoicing, delays, reimbursement details
5. **Auto-renewal clauses** - automatic extensions, opt-out requirements
6. **Vague or ambiguous language** - unclear obligations, missing definitions
7. **Housing, travel, CME, credentialing** - reimbursement details and caps
8. **Call burden, rate differentials, overtime** - clearly specified or vague

For each issue you find, provide:
- **quote**: Exact clause text from the contract (verbatim quote, 1-2 sentences max)
- **title**: Short issue name (e.g., "Non-compete clause", "Tail coverage ambiguity")
- **bucket**: Category - "Financial", "Restriction", "Ambiguity", or "Termination"
- **severity**: "Low", "Medium", or "High"
- **finding**: What the clause says in plain language (1-2 sentences)
- **whyItMatters**: Why this matters to a locums provider (1-2 sentences)
- **whatToAsk**: Specific question to ask recruiter or employer (1 sentence)
- **recommendation**: What to do about it (1-2 sentences)
- **emailLanguage** (optional): Suggested email text for negotiation if relevant

Also identify **missing or unclear terms** - items that should be in the contract but aren't specified:
- Tail coverage assignment
- Termination notice period
- Payment timing/invoice schedule
- Housing/travel/mileage reimbursement
- Credentialing/licensing costs
- Call burden details
- Rate differentials (overtime, callback, holiday)

Provide **severity buckets** as counts:
- financial: number of financial risk issues (0-3+)
- restriction: number of restriction risk issues (0-3+)
- ambiguity: number of ambiguity risk issues (0-3+)
- termination: number of termination risk issues (0-3+)

Return your analysis as JSON in this EXACT format:

{
  "riskLevel": "Low|Medium|High",
  "issues": [
    {
      "quote": "exact clause text here",
      "title": "Issue name",
      "bucket": "Financial|Restriction|Ambiguity|Termination",
      "severity": "Low|Medium|High",
      "finding": "What it says in plain language",
      "whyItMatters": "Why this matters to a locums provider",
      "whatToAsk": "Question to ask recruiter",
      "recommendation": "What to do about it",
      "emailLanguage": "Optional: suggested email text"
    }
  ],
  "missingTerms": [
    "Specific missing or unclear item",
    "Another missing item"
  ],
  "severityBuckets": {
    "financial": 0,
    "restriction": 0,
    "ambiguity": 1,
    "termination": 0
  },
  "summary": "Brief 2-3 sentence overall summary",
  "recruiterQuestions": [
    "Question 1 to ask recruiter",
    "Question 2 to ask recruiter"
  ],
  "takeToAttorney": [
    "Issue 1 that needs attorney review",
    "Issue 2 that needs attorney review"
  ]
}

IMPORTANT: 
- Return ONLY valid JSON, no markdown formatting, no backticks
- Include exact clause quotes (verbatim from contract)
- Be specific and actionable
- Focus on issues locums providers actually care about
- Keep plain language explanations clear and brief`;

    // Call Claude API
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

    // Extract JSON from response
    const text = message.content[0].text;
    
    // Try to find JSON in the response
    let analysis;
    
    // First try: direct JSON parse
    try {
      analysis = JSON.parse(text);
    } catch (e) {
      // Second try: extract JSON from markdown code blocks
      const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/) || text.match(/(\{[\s\S]*\})/);
      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error('Failed to parse contract analysis - no valid JSON found');
      }
    }
    
    // Validate required fields
    if (!analysis.riskLevel) {
      analysis.riskLevel = 'Medium';
    }
    if (!Array.isArray(analysis.issues)) {
      analysis.issues = [];
    }
    if (!Array.isArray(analysis.missingTerms)) {
      analysis.missingTerms = [];
    }
    if (!analysis.severityBuckets) {
      analysis.severityBuckets = {
        financial: 0,
        restriction: 0,
        ambiguity: 0,
        termination: 0
      };
    }
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        success: true, 
        analysis: analysis 
      })
    };
    
  } catch (error) {
    console.error('Contract analysis error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        success: false, 
        error: error.message || 'Contract analysis failed'
      })
    };
  }
};
