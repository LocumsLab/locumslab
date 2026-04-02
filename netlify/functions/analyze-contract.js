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

    // Super simple prompt - just the structure
    const prompt = `Analyze this contract. Return ONLY this JSON structure with NO extra text:

{"riskLevel":"Medium","issues":[{"quote":"text","title":"name","bucket":"Financial","severity":"Medium","finding":"what","whyItMatters":"why","whatToAsk":"question","recommendation":"do this"}],"missingTerms":["item"],"severityBuckets":{"financial":0,"restriction":0,"ambiguity":0,"termination":0},"summary":"summary","recruiterQuestions":["q"],"takeToAttorney":["issue"]}`;

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',  // This model WORKS - we tested it
      max_tokens: 2500,
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
    
    // Strip everything that's not JSON
    text = text.replace(/^[^{]*/, '');  // Remove everything before first {
    text = text.replace(/[^}]*$/, '');  // Remove everything after last }
    text = text.replace(/```json/g, '').replace(/```/g, '');  // Remove markdown
    text = text.replace(/,(\s*[}\]])/g, '$1');  // Remove trailing commas
    
    let analysis;
    try {
      analysis = JSON.parse(text);
    } catch (parseError) {
      // If still fails, return a minimal valid response
      console.error('JSON parse failed, returning minimal response');
      analysis = {
        riskLevel: 'Medium',
        issues: [],
        missingTerms: ['Unable to parse full analysis - please review contract manually'],
        severityBuckets: {financial: 0, restriction: 0, ambiguity: 0, termination: 0},
        summary: 'Analysis completed but response format was invalid. Please review contract carefully.',
        recruiterQuestions: ['Request full contract details'],
        takeToAttorney: ['Have attorney review due to analysis parsing issue']
      };
    }
    
    // Ensure all required fields
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
