// 1. Rate limiting
const RATE_LIMIT = 10; // Max 10 requests per hour per IP
if (requests.length >= RATE_LIMIT) {
  return { statusCode: 429, body: 'Too many requests' };
}

// 2. File size limit
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
if (estimatedSize > MAX_FILE_SIZE_BYTES) {
  return { statusCode: 413, body: 'File too large' };
}

// 3. PDF validation
const pdfHeader = Buffer.from(pdfBase64.substring(0, 20), 'base64').toString('binary');
if (!pdfHeader.startsWith('%PDF')) {
  return { statusCode: 400, body: 'Invalid PDF file' };
}

// 4. Server-side Pro verification (can't be spoofed)
const { data } = await supabase
  .from('entitlements')
  .select('plan, status')
  .eq('user_id', userId)
  .single();
userIsPro = data.plan === 'pro' && data.status === 'active';
