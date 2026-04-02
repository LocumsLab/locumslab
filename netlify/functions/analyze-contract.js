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

    const prompt = `Analyze this locums contract. Return ONLY valid JSON (no markdown, no explanation):

{
  "riskLevel": "Low|Medium|High",
  "issues": [{"quote": "clause", "title": "name", "bucket": "Financial|Restriction|Ambiguity|Termination", "severity": "Low|Medium|High", "finding": "explanation", "whyItMatters": "reason", "whatToAsk": "question", "recommendation": "advice"}],
  "missingTerms": ["item"],
  "severityBuckets": {"financial": 0, "restriction": 0, "ambiguity": 0, "termination": 0},
  "summary": "brief summary",
  "recruiterQuestions": ["question"],
  "takeToAttorney": ["issue"]
}`;

    const message = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',  // More reliable than Haiku, still under timeout
      max_tokens: 3000,  // Enough for good analysis
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
    
    // Remove markdown if present
    if (text.startsWith('```')) {
      text = text.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    }
    
    const analysis = JSON.parse(text);
    
    // Ensure fields exist
    analysis.riskLevel = analysis.riskLevel || 'Medium';
    analysis.issues = Array.isArray(analysis.issues) ? analysis.issues : [];
    analysis.missingTerms = Array.isArray(analysis.missingTerms) ? analysis.missingTerms : [];
    analysis.severityBuckets = analysis.severityBuckets || {financial: 0, restriction: 0, ambiguity: 0, termination: 0};
    analysis.recruiterQuestions = Array.isArray(analysis.recruiterQuestions) ? analysis.recruiterQuestions : [];
    analysis.takeToAttorney = Array.isArray(analysis.takeToAttorney) ? analysis.takeToAttorney : [];
    analysis.summary = analysis.summary || 'Analysis complete';
    
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
