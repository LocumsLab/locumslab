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

    const prompt = `Analyze this locums contract. Return ONLY valid JSON with this EXACT structure (no extra text, no markdown):

{
  "riskLevel": "Medium",
  "issues": [
    {
      "quote": "exact clause text",
      "title": "Issue name",
      "bucket": "Financial",
      "severity": "High",
      "finding": "What it says",
      "whyItMatters": "Why this matters",
      "whatToAsk": "Question to ask",
      "recommendation": "What to do"
    }
  ],
  "missingTerms": ["Missing item 1", "Missing item 2"],
  "severityBuckets": {"financial": 1, "restriction": 0, "ambiguity": 0, "termination": 0},
  "summary": "Brief summary of contract",
  "recruiterQuestions": ["Question 1"],
  "takeToAttorney": ["Critical issue 1"]
}

CRITICAL: Return ONLY the JSON object. No markdown, no code blocks, no extra text.`;

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
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

    let text = message.content[0].text;
    let analysis;
    
    // Try multiple parsing strategies
    try {
      // Strategy 1: Direct parse
      analysis = JSON.parse(text);
    } catch (e1) {
      try {
        // Strategy 2: Extract from markdown code blocks
        const jsonMatch = text.match(/```(?:json)?\s*({[\s\S]*?})\s*```/);
        if (jsonMatch) {
          analysis = JSON.parse(jsonMatch[1]);
        } else {
          // Strategy 3: Find JSON object in text
          const objectMatch = text.match(/{[\s\S]*}/);
          if (objectMatch) {
            // Clean up common issues
            let cleaned = objectMatch[0]
              .replace(/,\s*}/g, '}')  // Remove trailing commas
              .replace(/,\s*]/g, ']')  // Remove trailing commas in arrays
              .replace(/\n/g, ' ')     // Remove newlines
              .replace(/\t/g, ' ')     // Remove tabs
              .replace(/  +/g, ' ');    // Collapse multiple spaces
            
            analysis = JSON.parse(cleaned);
          } else {
            throw new Error('No JSON found in response');
          }
        }
      } catch (e2) {
        console.error('Failed to parse JSON:', text.substring(0, 500));
        throw new Error('Could not parse contract analysis');
      }
    }
    
    // Validate and set defaults
    if (!analysis.riskLevel) analysis.riskLevel = 'Medium';
    if (!Array.isArray(analysis.issues)) analysis.issues = [];
    if (!Array.isArray(analysis.missingTerms)) analysis.missingTerms = [];
    if (!analysis.severityBuckets) {
      analysis.severityBuckets = { financial: 0, restriction: 0, ambiguity: 0, termination: 0 };
    }
    if (!Array.isArray(analysis.recruiterQuestions)) analysis.recruiterQuestions = [];
    if (!Array.isArray(analysis.takeToAttorney)) analysis.takeToAttorney = [];
    if (!analysis.summary) analysis.summary = 'Contract analysis completed';
    
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
        error: 'Analysis failed: ' + error.message 
      })
    };
  }
};
