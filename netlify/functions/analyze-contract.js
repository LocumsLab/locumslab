const Anthropic = require('@anthropic-ai/sdk');

exports.handler = async (event) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { pdfBase64, filename } = JSON.parse(event.body);
    
    // Initialize Anthropic client with secret key from environment
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY, // Secret key stored safely
    });

    // Call Claude API
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
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
            text: `Analyze this locums healthcare contract and identify red flags. Focus on:

1. Non-compete clauses (especially in states where unenforceable)
2. Tail coverage requirements and costs
3. Cancellation penalties
4. Auto-renewal clauses
5. Vague or unclear language
6. Unreasonable restrictions
7. Missing critical details (housing, mileage, CME, etc.)
8. Payment terms and timing

Provide:
- Overall risk level (Low/Medium/High)
- List of specific red flags found with exact clause quotes
- Explanation of each issue
- Recommendations

Format as JSON:
{
  "riskLevel": "Low/Medium/High",
  "redFlags": [
    {
      "category": "...", 
      "severity": "...", 
      "clauseQuote": "exact text from contract",
      "finding": "...", 
      "recommendation": "...",
      "questionToAsk": "What you should ask employer/recruiter"
    }
  ],
  "missingTerms": ["...", "..."],
  "summary": "..."
}`
          }
        ]
      }]
    });

    // Extract JSON from response
    const text = message.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const analysis = JSON.parse(jsonMatch[0]);
      
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, analysis })
      };
    }
    
    throw new Error('Failed to parse analysis');
    
  } catch (error) {
    console.error('Contract analysis error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        success: false, 
        error: error.message 
      })
    };
  }
};
