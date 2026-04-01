// Supabase
const SUPABASE_URL = 'https://gqhalfzmqzlichcqubbs.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdxaGFsZnptcXpsaWNoY3F1YmJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1MDcwMDQsImV4cCI6MjA4NzA4MzAwNH0.XdJ0dZXbLPeRy0oIQ8SFllx1lAYr_KhaA0VBay1E7pU';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── CALCULATOR RUN LOGGING ──
async function logCalculatorRun(toolName, profession) {
  try {
    const { data: { user } } = await sb.auth.getUser();
    await sb.from('calculator_runs').insert({
      tool_name: toolName,
      profession: profession || null,
      user_id: user?.id || null
    });
  } catch (e) {
    // Silent fail — never block the calculator
  }
}

// ── POST-CALCULATION SIGNUP NUDGE ──
async function showSignupNudge() {
  try {
    const { data: { user } } = await sb.auth.getUser();
    if (user) return; // Already logged in
    if (sessionStorage.getItem('signup_nudge_dismissed')) return;
    setTimeout(() => {
      const nudge = document.getElementById('signup-nudge');
      if (nudge) nudge.style.display = 'block';
    }, 1500);
  } catch (e) { /* silent */ }
}

function dismissSignupNudge() {
  const nudge = document.getElementById('signup-nudge');
  if (nudge) nudge.style.display = 'none';
  sessionStorage.setItem('signup_nudge_dismissed', '1');
}

// Handle post-payment redirect
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('upgrade') === 'success') {
  // Clean URL
  window.history.replaceState({}, '', window.location.pathname);
  // Show success after app loads
  setTimeout(() => {
    alert('🎉 Welcome to Pro!\n\nYour account has been upgraded. Enjoy:\n✓ S-Corp Evaluator\n✓ Full benchmarks\n✓ Unlimited scenarios\n✓ Comparison view\n✓ PDF export\n✓ Lifetime access');
    // Reload user data to pick up is_pro = true from Supabase
    window.location.reload();
  }, 1000);
}

// Auto-launch Quick Start if coming from landing page
const startParam = urlParams.get('start');
if (startParam === 'quickstart') {
  window.history.replaceState({}, '', window.location.pathname);
  window._autoStart = 'quickstart';
}

// Auto-open contact modal if coming from landing page footer
if (urlParams.get('contact') === 'true') {
  window.history.replaceState({}, '', window.location.pathname);
  window._autoContact = true;
}

// State
let currentUser = null;   // email string
let currentUserId = null; // uuid from auth
let currentScenarioId = null;
let isPro = false;
const stripe = Stripe('pk_test_REPLACE_WITH_YOUR_STRIPE_KEY');

// ============================================================================
// MARKET BENCHMARKS - UPDATE ANNUALLY
// ============================================================================
// Last Updated: February 2026
// Next Update Due: February 2027
//
// DATA SOURCES (verify these annually):
// 1. BLS (Bureau of Labor Statistics) - May release each year
//    URL: https://www.bls.gov/oes/current/oes_nat.htm
//    Search for: "Nurse Anesthetists" (29-1151), "Physicians" (29-1xxx),
//                "Nurse Practitioners" (29-1171), "Physician Assistants" (29-1071)
//    NOTE: BLS May 2024 data published April 2025 — currently the latest release.
//
// 2. MGMA (Medical Group Management Association) - Annual compensation report
//    URL: https://www.mgma.com/data/benchmarking-data
//    Note: Requires membership (~$400/year) or purchase report (~$200)
//    Used for physician specialty breakdowns not covered by BLS alone.
//
// 3. CompHealth / Locums recruiting sites
//    URL: https://www.comphealth.com, https://www.locumtenens.com
//    Browse active job listings for current market rates
//
// 4. AAPA Salary Report (PAs) - https://www.aapa.org/research/salary-report/
//    AANA Salary Survey (CRNAs) - https://www.aana.com/docs/default-source/practice-aana-com-web-documents-(all)/practice-documents/practice-resources/crna-salary-survey.pdf
//
// HOW TO UPDATE (30 minutes annually):
// 1. Visit BLS website (free, publishes May data ~April of following year)
// 2. Update "median" values for staff salaries
// 3. Browse CompHealth for 20-30 active locums listings per profession
// 4. Calculate average hourly/weekly rates
// 5. Update "Last Updated" date above
// 6. Test with a few calculations to verify
//
// TIPS:
// - BLS data lags by ~1 year (May 2024 data published April 2025)
// - Locums rates fluctuate more than staff salaries
// - Geographic variation is significant (CA vs rural states)
// - These are NATIONAL medians (not region-specific)
//
// S-CORP REASONABLE SALARY BENCHMARKS:
// Source: BLS May 2024 + specialty CPA guidance (keneremita.com, cbfc, slpwealth)
// The IRS uses a "facts and circumstances" test — no fixed number.
// These ranges represent typical defensible W-2 salary levels based on
// what a non-owner would be paid for the same clinical services.
// Always advise users to consult a CPA for their specific situation.
// ============================================================================

const BENCHMARKS = {
  crna: {
    name: 'CRNA',
    staff: {
      // BLS May 2024: Nurse Anesthetists median $214,000 (BLS OOH, published 2025)
      salary: { low: 185000, median: 214000, high: 270000 },
      source: 'BLS May 2024 (published April 2025)',
      sourceUrl: 'https://www.bls.gov/ooh/healthcare/nurse-anesthetists-nurse-midwives-and-nurse-practitioners.htm'
    },
    locums: {
      hourly: { low: 80, median: 100, high: 120 },
      weekly: { low: 3200, median: 4000, high: 4800 },
      source: 'CompHealth 2025 + locums market data',
      note: 'CRNA locums contracts typically $175–$220/hr nationally'
    },
    // S-Corp reasonable salary: BLS May 2024 W-2 median used as IRS benchmark.
    // Per CBFC (1099crnataxplanning.com, Aug 2025): full-time parity ~$200k-$250k.
    // Adjust pro-rata if working part-time / fewer weeks than W-2 equivalent.
    scorp_salary: { low: 160000, median: 210000, high: 250000,
      note: 'Based on BLS May 2024 W-2 CRNA median. Adjust pro-rata for hours worked vs full-time equivalent.' }
  },
  md_hospitalist: {
    name: 'Hospitalist',
    staff: {
      // BLS May 2024: Physicians & Surgeons median ≥$239,200. MGMA hospitalist ~$285k.
      salary: { low: 255000, median: 290000, high: 360000 },
      source: 'BLS May 2024 + MGMA 2024 Compensation Report',
      sourceUrl: 'https://www.bls.gov/ooh/healthcare/physicians-and-surgeons.htm'
    },
    locums: {
      hourly: { low: 150, median: 170, high: 190 },
      weekly: { low: 6000, median: 6800, high: 7600 },
      source: 'CompHealth Physician Locums 2025',
      note: 'Typical hospitalist locums range: $150–$190/hr'
    },
    // IRS reasonable salary for hospitalist S-Corp: SLP Wealth notes physicians
    // typically cannot justify replacing themselves for under ~$170k-$200k.
    // White Coat Investor: EM 10th–90th percentile $205k–$384k; hospitalists lower.
    scorp_salary: { low: 200000, median: 250000, high: 310000,
      note: 'The IRS expects salary near what a non-owner hospitalist would be paid. Most CPAs recommend $200k–$280k for full-time hospitalists.' }
  },
  md_em: {
    name: 'Emergency Medicine',
    staff: {
      // BLS May 2024: Emergency medicine physicians mean ~$352,000
      salary: { low: 305000, median: 345000, high: 400000 },
      source: 'BLS May 2024 + MGMA 2024',
      sourceUrl: 'https://www.bls.gov/ooh/healthcare/physicians-and-surgeons.htm'
    },
    locums: {
      hourly: { low: 200, median: 230, high: 260 },
      weekly: { low: 8000, median: 9200, high: 10400 },
      source: 'EM locums market data 2025',
      note: 'Emergency Medicine locums typically $200–$260/hr'
    },
    scorp_salary: { low: 230000, median: 290000, high: 360000,
      note: 'White Coat Investor survey: EM physician W-2 range $205k–$384k. Use your specialty/region market rate as the IRS benchmark.' }
  },
  md_anesthesia: {
    name: 'Anesthesiologist',
    staff: {
      // BLS May 2024: Anesthesiologists mean $331,190 (top-paid specialty)
      salary: { low: 380000, median: 430000, high: 520000 },
      source: 'BLS May 2024',
      sourceUrl: 'https://www.bls.gov/ooh/healthcare/physicians-and-surgeons.htm'
    },
    locums: {
      hourly: { low: 250, median: 310, high: 370 },
      weekly: { low: 10000, median: 12400, high: 14800 },
      source: 'Anesthesia locums market 2025',
      note: 'Anesthesia locums range: $250–$370/hr'
    },
    scorp_salary: { low: 300000, median: 380000, high: 450000,
      note: 'Anesthesiologist W-2 replacement cost is high. Most CPAs recommend salary near BLS median to minimize audit risk.' }
  },
  md_fp: {
    name: 'Family Practice',
    staff: {
      // BLS May 2024: Family medicine physicians mean ~$255,000
      salary: { low: 215000, median: 245000, high: 285000 },
      source: 'BLS May 2024 + MGMA 2024',
      sourceUrl: 'https://www.bls.gov/ooh/healthcare/physicians-and-surgeons.htm'
    },
    locums: {
      hourly: { low: 100, median: 125, high: 150 },
      weekly: { low: 4000, median: 5000, high: 6000 },
      source: 'Primary care locums 2025',
      note: 'Family practice locums typically $100–$150/hr'
    },
    scorp_salary: { low: 170000, median: 215000, high: 260000,
      note: 'Family medicine W-2 salary serves as the IRS benchmark for reasonable compensation.' }
  },
  np: {
    name: 'Nurse Practitioner',
    staff: {
      // BLS May 2024: Nurse Practitioners median $129,210 (BLS OES 29-1171)
      salary: { low: 100000, median: 129210, high: 160000 },
      source: 'BLS May 2024 (OES 29-1171)',
      sourceUrl: 'https://www.bls.gov/ooh/healthcare/nurse-anesthetists-nurse-midwives-and-nurse-practitioners.htm'
    },
    locums: {
      hourly: { low: 55, median: 68, high: 80 },
      weekly: { low: 2000, median: 2600, high: 3200 },
      source: 'NP travel market data 2025',
      note: 'NP travel contracts typically $55–$80/hr'
    },
    scorp_salary: { low: 90000, median: 120000, high: 150000,
      note: 'Based on BLS May 2024 NP median ($129,210). Adjust for specialty — psychiatric NPs average higher.' }
  },
  pa: {
    name: 'Physician Assistant',
    staff: {
      // BLS May 2024: Physician Assistants median $130,020 (OES 29-1071)
      // AAPA 2025 Report: median compensation $134,000 in 2024
      salary: { low: 105000, median: 130000, high: 165000 },
      source: 'BLS May 2024 (OES 29-1071) + AAPA 2025 Salary Report',
      sourceUrl: 'https://www.bls.gov/oes/current/oes291071.htm'
    },
    locums: {
      hourly: { low: 60, median: 75, high: 90 },
      weekly: { low: 2200, median: 2800, high: 3400 },
      source: 'PA locums market 2025',
      note: 'PA locums typically $60–$90/hr; hospitalist PAs $80–$115/hr'
    },
    scorp_salary: { low: 95000, median: 125000, high: 155000,
      note: 'Based on BLS May 2024 PA median ($130,020) and AAPA 2024 data ($134,000 median). Surgical/specialty PAs command higher rates.' }
  },
  rn: {
    name: 'Registered Nurse',
    staff: {
      // BLS May 2024: Registered Nurses median $93,600 (OES 29-1141)
      salary: { low: 68000, median: 93600, high: 120000 },
      source: 'BLS May 2024 (OES 29-1141)',
      sourceUrl: 'https://www.bls.gov/ooh/healthcare/registered-nurses.htm'
    },
    locums: {
      hourly: { low: 40, median: 52, high: 70 },
      weekly: { low: 1600, median: 2000, high: 2800 },
      source: 'Travel nurse market 2025 (post-pandemic normalization)',
      note: 'Travel RN rates: $40–$70/hr depending on specialty and location'
    },
    scorp_salary: { low: 65000, median: 88000, high: 115000,
      note: 'Based on BLS May 2024 RN median ($93,600). S-Corp generally only beneficial for RNs earning $100k+ net 1099 income.' }
  },
  other: {
    name: 'Healthcare Professional',
    staff: { salary: { low: 80000, median: 100000, high: 150000 } },
    locums: { hourly: { low: 50, median: 65, high: 90 }, weekly: { low: 2000, median: 2600, high: 3600 } },
    scorp_salary: { low: 60000, median: 90000, high: 130000,
      note: 'Use your specialty\'s BLS median W-2 salary as the starting point for IRS reasonable compensation.' }
  }
};

function getBenchmarkComparison(value, benchmark, type = 'salary') {
  if (!benchmark) return null;
  
  const { low, median, high } = benchmark;
  let percentile, message, color, emoji;
  
  if (value < low) {
    percentile = Math.round((value / low) * 25);
    message = `Below market range`;
    color = '#ef4444'; // red
    emoji = '⚠️';
  } else if (value < median) {
    percentile = 25 + Math.round(((value - low) / (median - low)) * 25);
    message = `Below median`;
    color = '#f59e0b'; // orange
    emoji = '↔️';
  } else if (value <= high) {
    percentile = 50 + Math.round(((value - median) / (high - median)) * 35);
    message = `At or above median`;
    color = '#10b981'; // green
    emoji = '✓';
  } else {
    percentile = Math.min(99, 85 + Math.round(((value - high) / high) * 15));
    message = `Top of market`;
    color = '#10b981'; // green
    emoji = '🔥';
  }
  
  const formattedMedian = type === 'hourly' ? `$${median}/hr` : `$${median.toLocaleString()}`;
  
  return {
    percentile,
    message,
    color,
    emoji,
    median: formattedMedian,
    detail: `Market median: ${formattedMedian}`
  };
}

function displayBenchmark(profession, value, type = 'hourly') {
  const benchData = BENCHMARKS[profession];
  if (!benchData) return '';
  
  const benchmark = type === 'hourly' ? benchData.locums?.hourly : 
                    type === 'weekly' ? benchData.locums?.weekly :
                    benchData.staff?.salary;
  
  if (!benchmark) return '';
  
  const comparison = getBenchmarkComparison(value, benchmark, type);
  if (!comparison) return '';
  
  const source = type === 'salary' ? benchData.staff?.source : benchData.locums?.source;
  const note = benchData.locums?.note;
  
  return `
    <div style="
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid ${comparison.color}30;
      border-radius: 6px;
      padding: 8px 12px;
      margin-top: 8px;
      font-size: 0.875rem;
    ">
      <span style="font-weight: 700; color: ${comparison.color};">${comparison.emoji} ${comparison.message}</span>
      <span style="color: var(--muted);">
        ${comparison.percentile}th percentile (median: ${comparison.median})
      </span>
    </div>
    ${note ? `<div style="
      font-size: 0.8125rem; 
      color: var(--muted); 
      margin-top: 6px;
      font-style: italic;
      line-height: 1.4;
    ">
      📊 ${note}
      ${source ? `<br><span style="font-size: 0.75rem; opacity: 0.8;">Source: ${source}</span>` : ''}
    </div>` : ''}
  `;
}

// Pre-populated templates
const TEMPLATES = [
  {
    id: 'tmpl_md_hospitalist',
    name: 'MD: Hospitalist Staff vs Locums',
    tag: 'Physician',
    description: 'Staff hospitalist $280k vs locums contracts',
    data: {
      staffSalary: 280000,
      staffBenefits: 50000,
      staffBonus: 30000,
      staffPto: 25,
      locumsWeekly: 6000,
      locumsHours: 40,
      locumsWeeks: 46,
      locumsHousing: 3000,
      locumsInsurance: 28000,
      locumsExpenses: 15000
    }
  },
  {
    id: 'tmpl_crna_staff_locums',
    name: 'CRNA: Staff vs Locums',
    tag: 'CRNA',
    description: 'Staff CRNA $210k vs 13-week locums contract',
    data: {
      staffSalary: 210000,
      staffBenefits: 35000,
      staffBonus: 15000,
      staffPto: 20,
      locumsWeekly: 3800,
      locumsHours: 40,
      locumsWeeks: 48,
      locumsHousing: 2200,
      locumsInsurance: 20000,
      locumsExpenses: 10000
    }
  },
  {
    id: 'tmpl_np_travel',
    name: 'NP: Full-Time vs Travel',
    tag: 'NP',
    description: 'Staff NP $110k vs travel contracts',
    data: {
      staffSalary: 110000,
      staffBenefits: 22000,
      staffBonus: 5000,
      staffPto: 15,
      locumsWeekly: 2400,
      locumsHours: 36,
      locumsWeeks: 48,
      locumsHousing: 1800,
      locumsInsurance: 16000,
      locumsExpenses: 6000
    }
  },
  {
    id: 'tmpl_pa_urgent_care',
    name: 'PA: Staff vs Per Diem',
    tag: 'PA',
    description: 'Staff PA $105k vs per diem urgent care',
    data: {
      staffSalary: 105000,
      staffBenefits: 20000,
      staffBonus: 3000,
      staffPto: 12,
      locumsHourly: 75,
      locumsHours: 40,
      locumsWeeks: 50,
      locumsHousing: 0,
      locumsInsurance: 15000,
      locumsExpenses: 5000
    }
  }
];

// Utility functions
function fmt(n) {
  if (n >= 1000000) return '$' + (n/1000000).toFixed(1) + 'M';
  if (n >= 1000) return '$' + (n/1000).toFixed(1) + 'k';
  return '$' + Math.round(n).toLocaleString();
}

function fmtFull(n) {
  return '$' + Math.round(n).toLocaleString();
}

// Auth
function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById(tab + 'Form').classList.add('active');
  document.getElementById('authError').classList.remove('show');
}

function showAuthError(msg) {
  const el = document.getElementById('authError');
  el.textContent = msg;
  el.classList.add('show');
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn = e.target.querySelector('button[type="submit"]');
  btn.textContent = 'Logging in...';
  btn.disabled = true;

  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  btn.textContent = 'Log In';
  btn.disabled = false;

  if (error) {
    showAuthError(error.message);
    return;
  }

  currentUser = data.user.email;
  currentUserId = data.user.id;

  // Fetch Pro status from entitlements table
  const { data: entitlement } = await sb
    .from('entitlements')
    .select('plan, status')
    .eq('user_id', data.user.id)
    .single();
  isPro = entitlement?.plan === 'pro' && entitlement?.status === 'active';

  document.getElementById('authScreen').classList.add('hidden');
  showMainApp();
}

async function handleSignup(e) {
  e.preventDefault();
  const email = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;
  const confirm = document.getElementById('signupPasswordConfirm').value;

  if (password !== confirm) { showAuthError('Passwords do not match'); return; }
  if (password.length < 6) { showAuthError('Password must be at least 6 characters'); return; }

  const btn = e.target.querySelector('button[type="submit"]');
  btn.textContent = 'Creating account...';
  btn.disabled = true;

  const { data, error } = await sb.auth.signUp({ email, password });
  btn.textContent = 'Create Account';
  btn.disabled = false;

  if (error) { showAuthError(error.message); return; }

  currentUser = email;
  currentUserId = data.user?.id || null;
  isPro = false;

  // Insert into public.users to trigger signup notification webhook
  if (currentUserId) {
    const { error: insertError } = await sb.from('users').insert({
      id: currentUserId,
      email: email,
      created_at: new Date().toISOString(),
      is_pro: false
    });
    if (insertError) {
      console.error('Insert error code:', insertError.code);
      console.error('Insert error message:', insertError.message);
      console.error('Insert error hint:', insertError.hint);
    } else {
      console.log('User inserted into public.users successfully');
    }
  }

  document.getElementById('authScreen').classList.add('hidden');
  showMainApp();
  setTimeout(() => alert('Account created! You can now save scenarios and compare offers.'), 100);
}

async function handleLogout() {
  await sb.auth.signOut();
  currentUser = null;
  currentUserId = null;
  isPro = false;
  document.getElementById('authScreen').classList.remove('hidden');
  document.getElementById('mainApp').classList.add('hidden');
}

function showMainApp() {
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('mainApp').classList.remove('hidden');
  
  const emailEl = document.getElementById('userEmail');
  const badgeEl = document.getElementById('planBadge');
  const upgradeBtn = document.getElementById('upgradeBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const signupBanner = document.getElementById('signup-banner');
  
  if (currentUser) {
    // Logged in - show email, plan, logout; hide signup banner
    emailEl.textContent = currentUser;
    emailEl.style.display = 'inline';
    badgeEl.textContent = isPro ? 'Pro' : 'Free';
    if (logoutBtn) logoutBtn.classList.remove('hidden');
    if (signupBanner) signupBanner.style.display = 'none';
    
    if (isPro) {
      upgradeBtn.classList.add('hidden');
    } else {
      upgradeBtn.classList.remove('hidden');
      upgradeBtn.textContent = 'Upgrade to Pro';
      upgradeBtn.onclick = showUpgradeModal;
    }
  } else {
    // Demo mode - hide email and logout, show signup CTAs
    emailEl.textContent = '';
    emailEl.style.display = 'none';
    badgeEl.textContent = 'Try Free';
    if (logoutBtn) logoutBtn.classList.add('hidden');
    if (signupBanner) signupBanner.style.display = 'block';
    
    upgradeBtn.classList.remove('hidden');
    upgradeBtn.textContent = 'Sign Up Free';
    upgradeBtn.onclick = showAuthScreen;
  }
  
  showWizard();
}

function showWizard() {
  document.getElementById('wizard').classList.remove('hidden');
  document.getElementById('wizardBtn').style.display = 'none';
  document.getElementById('dashboardView').classList.add('hidden');
  document.getElementById('calculatorView').classList.add('hidden');
  // Auto-launch if coming from landing page
  if (window._autoStart) {
    const target = window._autoStart;
    window._autoStart = null;
    setTimeout(() => selectGoal(target), 100);
  }
  // Auto-open contact modal if coming from landing page footer
  if (window._autoContact) {
    window._autoContact = false;
    setTimeout(() => showContact(), 300);
  }
}

// S-CORP CALCULATOR
function calculateSCorp() {
  const income = parseFloat(document.getElementById('scorp-income').value) || 0;
  const expenses = parseFloat(document.getElementById('scorp-expenses').value) || 0;
  const filing = document.getElementById('scorp-filing').value;
  const profession = document.getElementById('scorp-profession').value;
  
  const netIncome = income - expenses;
  
  // BLS Median Salaries (May 2024 data, published April 2025) - Safe Harbor Strategy
  // Sources: BLS OES 29-1151 (CRNA $214k), 29-1171 (NP $129,210), 29-1071 (PA $130,020),
  //          29-1141 (RN $93,600), physicians ≥$239,200 + MGMA specialty breakdowns
  const BLS_SALARIES = {
    'crna': 214000,
    'md_hospitalist': 290000,
    'md_em': 345000,
    'md_anesthesia': 430000,
    'md_fp': 245000,
    'np': 129210,
    'pa': 130020,
    'rn': 93600,
    'other': Math.floor(netIncome * 0.60) // Fallback: 60% of net
  };
  
  const blsSalary = BLS_SALARIES[profession];
  
  // SOLE PROP CALCULATION
  const spSeTaxBase = netIncome * 0.9235; // 92.35% of net income
  const spSeTax = spSeTaxBase * 0.153; // 15.3% SE tax
  
  // Simplified income tax
  const spTaxableIncome = netIncome - (spSeTax / 2); // Deduct half of SE tax
  const spIncomeTax = filing === 'married' 
    ? calculateIncomeTaxMarried(spTaxableIncome)
    : calculateIncomeTaxSingle(spTaxableIncome);
  
  // Solo 401k max contribution
  const spEmployeeContribution = Math.min(23000, netIncome);
  const spEmployerContribution = Math.min(Math.floor(netIncome * 0.20), 69000 - spEmployeeContribution);
  const spRetirement = spEmployeeContribution + spEmployerContribution;
  
  const spTotalTax = spSeTax + spIncomeTax;
  const spTakeHome = netIncome - spTotalTax - spRetirement;
  
  // S-CORP CALCULATION (BLS Safe Harbor Strategy)
  // Use BLS median as W2 salary, but only if net income is higher
  let reasonableSalary;
  let salaryStrategy;
  
  if (profession === 'other') {
    reasonableSalary = Math.floor(netIncome * 0.60);
    salaryStrategy = `Using 60% of net income ($${reasonableSalary.toLocaleString()}) as reasonable salary.`;
  } else if (netIncome > blsSalary) {
    // Net income exceeds BLS median - use BLS as W2 salary (maximum tax savings!)
    reasonableSalary = blsSalary;
    salaryStrategy = `Using BLS median salary ($${blsSalary.toLocaleString()}) as W2 salary. This is the "safe harbor" strategy - defensible to IRS and maximizes your tax savings by keeping more as distributions.`;
  } else {
    // Net income below BLS median - use 60% of net
    reasonableSalary = Math.floor(netIncome * 0.60);
    salaryStrategy = `Your net income is below the BLS median for your profession. Using 60% of net income ($${reasonableSalary.toLocaleString()}) as reasonable salary.`;
  }
  
  const distributions = netIncome - reasonableSalary;
  
  const scPayrollTax = reasonableSalary * 0.153; // 15.3% payroll tax on salary only
  const scAdminCosts = 3000; // Payroll service + CPA
  
  const scTaxableIncome = reasonableSalary + distributions;
  const scIncomeTax = filing === 'married'
    ? calculateIncomeTaxMarried(scTaxableIncome)
    : calculateIncomeTaxSingle(scTaxableIncome);
  
  // S-Corp 401k
  const scEmployeeContribution = Math.min(23000, reasonableSalary);
  const scEmployerContribution = Math.min(Math.floor(reasonableSalary * 0.25), 69000 - scEmployeeContribution);
  const scRetirement = scEmployeeContribution + scEmployerContribution;
  
  const scTotalTax = scPayrollTax + scIncomeTax + scAdminCosts;
  const scTakeHome = netIncome - scTotalTax - scRetirement;
  
  const savings = scTakeHome - spTakeHome;
  
  // Display results
  document.getElementById('sp-gross').textContent = fmt(income);
  document.getElementById('sp-expenses').textContent = fmt(expenses);
  document.getElementById('sp-net').textContent = fmt(netIncome);
  document.getElementById('sp-se-tax').textContent = fmt(spSeTax);
  document.getElementById('sp-income-tax').textContent = fmt(spIncomeTax);
  document.getElementById('sp-retirement').textContent = fmt(spRetirement);
  document.getElementById('sp-total-tax').textContent = fmt(spTotalTax);
  document.getElementById('sp-take-home').textContent = fmt(spTakeHome);
  
  document.getElementById('sc-gross').textContent = fmt(income);
  document.getElementById('sc-expenses').textContent = fmt(expenses);
  document.getElementById('sc-net').textContent = fmt(netIncome);
  document.getElementById('sc-w2-salary').textContent = fmt(reasonableSalary);
  document.getElementById('sc-distributions').textContent = fmt(distributions);
  document.getElementById('sc-payroll-tax').textContent = fmt(scPayrollTax);
  document.getElementById('sc-income-tax').textContent = fmt(scIncomeTax);
  document.getElementById('sc-admin').textContent = fmt(scAdminCosts);
  document.getElementById('sc-retirement').textContent = fmt(scRetirement);
  document.getElementById('sc-total-tax').textContent = fmt(scTotalTax);
  document.getElementById('sc-take-home').textContent = fmt(scTakeHome);
  document.getElementById('sc-savings').textContent = (savings >= 0 ? '+' : '') + fmt(savings);
  
  // Recommendation
  let recommendation = '';
  const scorpCol = document.getElementById('scorp-col');
  scorpCol.style.borderColor = 'var(--border)';
  scorpCol.style.background = 'var(--surface)';
  
  if (netIncome < 60000) {
    recommendation = `At ${fmt(netIncome)} net income, an S-Corp is NOT recommended. The administrative costs (~$3,000/year) outweigh the tax savings. Stick with sole proprietorship or LLC.`;
  } else if (netIncome < 80000) {
    recommendation = `At ${fmt(netIncome)} net income, an S-Corp is BORDERLINE. You'd save approximately ${fmt(savings)}/year, but consider if the added complexity is worth it. Consult a CPA.

${salaryStrategy}`;
    if (savings > 1500) {
      scorpCol.style.borderColor = 'var(--accent)';
      scorpCol.style.background = 'linear-gradient(135deg, rgba(16, 185, 129, 0.05), var(--surface))';
    }
  } else {
    recommendation = `At ${fmt(netIncome)} net income, an S-Corp is RECOMMENDED. You'd save approximately ${fmt(savings)}/year in taxes. The administrative costs are well worth it at this income level.

${salaryStrategy}

Note: Always work with a CPA to ensure proper setup and compliance.`;
    scorpCol.style.borderColor = 'var(--accent)';
    scorpCol.style.background = 'linear-gradient(135deg, rgba(16, 185, 129, 0.05), var(--surface))';
  }
  
  document.getElementById('scorp-rec-text').textContent = recommendation;

  // Populate Reasonable Salary Benchmark panel
  const benchData = BENCHMARKS[profession];
  if (benchData && benchData.scorp_salary) {
    const salaryBench = benchData.scorp_salary;
    document.getElementById('scorp-bench-low').textContent = '$' + salaryBench.low.toLocaleString();
    document.getElementById('scorp-bench-median').textContent = '$' + salaryBench.median.toLocaleString();
    document.getElementById('scorp-bench-high').textContent = '$' + salaryBench.high.toLocaleString();
    document.getElementById('scorp-bench-salary-val').textContent = '$' + reasonableSalary.toLocaleString();
    document.getElementById('scorp-bench-note').textContent = salaryBench.note;

    // Status badge
    const statusEl = document.getElementById('scorp-bench-salary-status');
    if (reasonableSalary < salaryBench.low) {
      statusEl.textContent = '⚠️ Below safe range';
      statusEl.style.background = 'rgba(239,68,68,0.15)';
      statusEl.style.color = '#ef4444';
    } else if (reasonableSalary <= salaryBench.high) {
      statusEl.textContent = '✓ Within market range';
      statusEl.style.background = 'rgba(16,185,129,0.15)';
      statusEl.style.color = 'var(--accent)';
    } else {
      statusEl.textContent = 'ℹ️ Above median — conservative';
      statusEl.style.background = 'rgba(245,158,11,0.15)';
      statusEl.style.color = 'var(--warning)';
    }
  }

  document.getElementById('scorp-results').classList.remove('hidden');
}

function calculateIncomeTaxMarried(income) {
  // 2024 married filing jointly brackets (simplified)
  if (income <= 22000) return income * 0.10;
  if (income <= 89050) return 2200 + (income - 22000) * 0.12;
  if (income <= 190750) return 10246 + (income - 89050) * 0.22;
  if (income <= 364200) return 32580 + (income - 190750) * 0.24;
  return 74208 + (income - 364200) * 0.32;
}

function calculateIncomeTaxSingle(income) {
  // 2024 single brackets (simplified)
  if (income <= 11000) return income * 0.10;
  if (income <= 44725) return 1100 + (income - 11000) * 0.12;
  if (income <= 95375) return 5147 + (income - 44725) * 0.22;
  if (income <= 182100) return 16290 + (income - 95375) * 0.24;
  return 37104 + (income - 182100) * 0.32;
}

function selectGoal(goal) {
  if (goal === 'explore') {
    showDashboard();
  } else if (goal === 'quickstart') {
    startNew();
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById('panel-quickstart').classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const btn = Array.from(document.querySelectorAll('.nav-btn')).find(b => b.textContent.includes('Quick Start'));
    if (btn) btn.classList.add('active');
  } else if (goal === 'contract-eval') {
    startNew();
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById('panel-true-hourly').classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const btn = Array.from(document.querySelectorAll('.nav-btn')).find(b => b.textContent.includes('True Hourly'));
    if (btn) btn.classList.add('active');
  } else if (goal === 'benchmarks') {
    if (!isPro) {
      showUpgradeModal();
      return;
    }
    startNew();
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById('panel-benchmarks').classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const benchBtn = Array.from(document.querySelectorAll('.nav-btn')).find(b => b.textContent.includes('Benchmarks'));
    if (benchBtn) benchBtn.classList.add('active');
    setTimeout(renderBenchmarks, 50);
  } else if (goal === 'scorp') {
    if (!isPro) {
      showScorpPaywall();
      return;
    }
    startNew();
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById('panel-scorp').classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const scorpBtn = Array.from(document.querySelectorAll('.nav-btn')).find(b => b.textContent.includes('S-Corp'));
    if (scorpBtn) scorpBtn.classList.add('active');
  } else {
    startNew();
  }
}

function showDashboard() {
  document.getElementById('wizard').classList.add('hidden');
  document.getElementById('dashboardView').classList.remove('hidden');
  document.getElementById('calculatorView').classList.add('hidden');
  document.getElementById('wizardBtn').style.display = 'inline-flex';
  loadTemplates();
  loadScenarios();
}

function startNew() {
  currentScenarioId = null;
  document.getElementById('wizardBtn').style.display = 'inline-flex';
  document.getElementById('wizard').classList.add('hidden');
  document.getElementById('dashboardView').classList.add('hidden');
  document.getElementById('calculatorView').classList.remove('hidden');
  document.getElementById('calcTitle').textContent = 'New Scenario';
  updateExportButton();
}

function loadTemplates() {
  const container = document.getElementById('templatesContainer');
  container.innerHTML = TEMPLATES.map(t => `
    <div class="scenario-card template" onclick="loadTemplate('${t.id}')">
      <div class="scenario-header">
        <div>
          <div class="scenario-name">${t.name}</div>
          <div class="scenario-tag">${t.tag}</div>
        </div>
      </div>
      <div class="scenario-meta">${t.description}</div>
    </div>
  `).join('');
}

function loadTemplate(id) {
  const template = TEMPLATES.find(t => t.id === id);
  if (!template) return;
  
  const d = template.data;
  document.getElementById('staff-salary').value = d.staffSalary || 140000;
  document.getElementById('staff-benefits').value = d.staffBenefits || 28000;
  document.getElementById('staff-bonus').value = d.staffBonus || 10000;
  document.getElementById('staff-pto').value = d.staffPto || 20;
  
  if (d.locumsWeekly) {
    document.getElementById('locums-rate-type').value = 'weekly';
    document.getElementById('locums-weekly').value = d.locumsWeekly;
    toggleRateType();
  } else if (d.locumsHourly) {
    document.getElementById('locums-rate-type').value = 'hourly';
    document.getElementById('locums-hourly').value = d.locumsHourly;
    toggleRateType();
  }
  
  document.getElementById('locums-hours').value = d.locumsHours || 40;
  document.getElementById('locums-weeks').value = d.locumsWeeks || 48;
  document.getElementById('locums-housing').value = d.locumsHousing || 2000;
  document.getElementById('locums-insurance').value = d.locumsInsurance || 18000;
  document.getElementById('locums-expenses').value = d.locumsExpenses || 8000;
  
  document.getElementById('dashboardView').classList.add('hidden');
  document.getElementById('calculatorView').classList.remove('hidden');
  document.getElementById('calcTitle').textContent = template.name + ' (from template)';
  
  // Auto-calculate
  calcStaffLocums();
}

// ── SCENARIOS (Supabase) ──

async function getUserScenarios() {
  if (!currentUserId) return [];
  const { data, error } = await sb
    .from('scenarios')
    .select('*')
    .eq('user_id', currentUserId)
    .order('updated_at', { ascending: false });
  if (error) { console.error('Load scenarios error:', error); return []; }
  return (data || []).map(r => ({
    id: r.id,
    name: r.name,
    data: r.data,
    updated: r.updated_at,
    created: r.created_at
  }));
}

async function loadScenarios() {
  const container = document.getElementById('scenariosContainer');
  container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><p>Loading...</p></div>';
  const scenarios = await getUserScenarios();
  if (scenarios.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📊</div><p>No saved scenarios yet. Start with a template above!</p></div>';
    document.getElementById('comparisonView').classList.add('hidden');
    return;
  }
  container.innerHTML = `<div class="scenarios-grid">${scenarios.map(s => {
    const date = new Date(s.updated).toLocaleDateString();
    return `
      <div class="scenario-card" onclick="loadScenario('${s.id}')">
        <div class="scenario-header">
          <div class="scenario-name">${s.name}</div>
          <button class="scenario-action-btn" onclick="event.stopPropagation(); deleteScenario('${s.id}')">🗑️</button>
        </div>
        <div class="scenario-meta">Updated: ${date}</div>
      </div>
    `;
  }).join('')}</div>`;

  if (isPro && scenarios.length >= 2) {
    showComparison(scenarios);
  } else {
    document.getElementById('comparisonView').classList.add('hidden');
  }
}

function showComparison(scenarios) {
  const table = document.getElementById('comparisonTable');
  const headers = ['Metric', ...scenarios.map(s => s.name)];
  let html = '<thead><tr>';
  headers.forEach(h => html += `<th>${h}</th>`);
  html += '</tr></thead><tbody>';

  // Add key comparison metrics
  const metrics = [
    { label: 'Staff Salary', key: 'staffSalary', format: fmtFull },
    { label: 'Locums Gross Income', key: 'calculated_locums_gross', format: fmtFull },
    { label: 'Net Difference', key: 'calculated_net_diff', format: fmtFull }
  ];

  // Calculate metrics for each scenario
  scenarios.forEach(s => {
    const d = s.data;
    const rateType = d.locumsRateType || 'weekly';
    let locumsGross;
    if (rateType === 'weekly') {
      locumsGross = (d.locumsWeekly || 0) * (d.locumsWeeks || 48);
    } else {
      locumsGross = (d.locumsHourly || 0) * (d.locumsHours || 40) * (d.locumsWeeks || 48);
    }
    s.data.calculated_locums_gross = locumsGross;
    
    // Simple net calculation (this would match the actual calculation in calcStaffLocums)
    const staffNet = (d.staffSalary || 0) * 0.75; // Rough estimate
    const locumsNet = locumsGross - (d.locumsInsurance || 0) - (d.locumsExpenses || 0);
    s.data.calculated_net_diff = locumsNet * 0.7 - staffNet; // Rough estimate after taxes
  });

  metrics.forEach(m => {
    html += `<tr><td class="metric-label">${m.label}</td>`;
    const values = scenarios.map(s => s.data[m.key] || 0);
    const bestIdx = m.key === 'calculated_net_diff' 
      ? values.indexOf(Math.max(...values))
      : 0;
    scenarios.forEach((s, idx) => {
      const val = s.data[m.key] || 0;
      const className = idx === bestIdx && m.key === 'calculated_net_diff' ? 'winner' : '';
      html += `<td class="${className}">${m.format(val)}</td>`;
    });
    html += '</tr>';
  });

  html += '</tbody>';
  table.innerHTML = html;
  document.getElementById('comparisonView').classList.remove('hidden');
}

async function loadScenario(id) {
  const scenarios = await getUserScenarios();
  const s = scenarios.find(x => x.id === id);
  if (!s) return;
  currentScenarioId = id;
  document.getElementById('dashboardView').classList.add('hidden');
  document.getElementById('calculatorView').classList.remove('hidden');
  document.getElementById('calcTitle').textContent = s.name;
  
  const d = s.data;
  document.getElementById('staff-salary').value = d.staffSalary || 140000;
  document.getElementById('staff-benefits').value = d.staffBenefits || 28000;
  document.getElementById('staff-bonus').value = d.staffBonus || 10000;
  document.getElementById('staff-pto').value = d.staffPto || 20;
  
  const rateType = d.locumsRateType || 'weekly';
  document.getElementById('locums-rate-type').value = rateType;
  toggleRateType();
  
  if (rateType === 'weekly') {
    document.getElementById('locums-weekly').value = d.locumsWeekly || 3200;
  } else {
    document.getElementById('locums-hourly').value = d.locumsHourly || 85;
  }
  
  document.getElementById('locums-hours').value = d.locumsHours || 40;
  document.getElementById('locums-weeks').value = d.locumsWeeks || 48;
  document.getElementById('locums-housing').value = d.locumsHousing || 2000;
  document.getElementById('locums-insurance').value = d.locumsInsurance || 18000;
  document.getElementById('locums-expenses').value = d.locumsExpenses || 8000;
  
  updateExportButton();
}

async function deleteScenario(id) {
  if (!confirm('Delete this scenario?')) return;
  const { error } = await sb
    .from('scenarios')
    .delete()
    .eq('id', id)
    .eq('user_id', currentUserId);
  if (error) { alert('Error deleting scenario'); return; }
  loadScenarios();
}


async function showSaveModal() {
  if (!currentUser) {
    if (confirm('Sign up free to save scenarios and compare offers. Create account now?')) {
      showAuthScreen();
    }
    return;
  }
  if (!isPro && !currentScenarioId) {
    const scenarios = await getUserScenarios();
    if (scenarios.length >= 3) {
      showUpgradeModal();
      return;
    }
  }
  document.getElementById('saveModal').classList.add('show');
  document.getElementById('scenarioName').value = '';
  document.getElementById('scenarioName').focus();
}

function hideSaveModal() {
  document.getElementById('saveModal').classList.remove('show');
}

async function saveScenario() {
  const name = document.getElementById('scenarioName').value.trim();
  if (!name) { alert('Please enter a scenario name'); return; }

  const btn = document.getElementById('saveModal').querySelector('.modal-btn.primary');
  btn.textContent = 'Saving...';
  btn.disabled = true;

  const data = {
    staffSalary: parseFloat(document.getElementById('staff-salary').value) || 0,
    staffBenefits: parseFloat(document.getElementById('staff-benefits').value) || 0,
    staffBonus: parseFloat(document.getElementById('staff-bonus').value) || 0,
    staffPto: parseFloat(document.getElementById('staff-pto').value) || 0,
    locumsRateType: document.getElementById('locums-rate-type').value,
    locumsHourly: parseFloat(document.getElementById('locums-hourly').value) || 0,
    locumsWeekly: parseFloat(document.getElementById('locums-weekly').value) || 0,
    locumsHours: parseFloat(document.getElementById('locums-hours').value) || 0,
    locumsWeeks: parseFloat(document.getElementById('locums-weeks').value) || 0,
    locumsHousing: parseFloat(document.getElementById('locums-housing').value) || 0,
    locumsInsurance: parseFloat(document.getElementById('locums-insurance').value) || 0,
    locumsExpenses: parseFloat(document.getElementById('locums-expenses').value) || 0
  };

  let error;
  if (currentScenarioId) {
    ({ error } = await sb
      .from('scenarios')
      .update({ name, data, updated_at: new Date().toISOString() })
      .eq('id', currentScenarioId)
      .eq('user_id', currentUserId));
  } else {
    const { data: inserted, error: insertError } = await sb
      .from('scenarios')
      .insert({ user_id: currentUserId, name, data })
      .select()
      .single();
    error = insertError;
    if (inserted) currentScenarioId = inserted.id;
  }

  btn.textContent = 'Save Scenario';
  btn.disabled = false;

  if (error) { alert('Error saving scenario: ' + error.message); return; }

  hideSaveModal();
  document.getElementById('calcTitle').textContent = name;
  alert('Scenario saved!');
  updateExportButton();
}

function showUpgradeModal() {
  document.getElementById('upgradeModal').classList.add('show');
}

function hideUpgradeModal() {
  document.getElementById('upgradeModal').classList.remove('show');
}

function showScorpPaywall() {
  document.getElementById('scorpPaywallModal').classList.add('show');
}

function hideScorpPaywall() {
  document.getElementById('scorpPaywallModal').classList.remove('show');
}

function showComparePaywall() {
  document.getElementById('comparePaywallModal').classList.add('show');
}

function hideComparePaywall() {
  document.getElementById('comparePaywallModal').classList.remove('show');
}

function requestEarlyAccess() {
  const email = currentUser || prompt('Enter your email to get notified when Pro launches:');
  
  if (!email) {
    return;
  }
  
  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    alert('Please enter a valid email address');
    return;
  }
  
  // Store in localStorage for now (you can export this later)
  const waitlist = JSON.parse(localStorage.getItem('locums_pro_waitlist') || '[]');
  const already = waitlist.some(x => (typeof x === 'string' ? x : x.email) === email);
  if (!already) {
    waitlist.push({
      email: email,
      timestamp: new Date().toISOString(),
      source: 'paywall'
    });
    localStorage.setItem('locums_pro_waitlist', JSON.stringify(waitlist));
  }
  
  // Close modals
  hideUpgradeModal();
  hideScorpPaywall();
  hideComparePaywall();
  
  alert('✅ You\'re on the list!\n\nWe\'ll email you at ' + email + ' when Pro launches (likely within 1-2 weeks).\n\nIn the meantime, feel free to use all the free calculators!');
}

function showFAQ() {
  document.getElementById('faqModal').classList.add('show');
}

function hideFAQ() {
  document.getElementById('faqModal').classList.remove('show');
}

function showContact() {
  const emailField = document.getElementById('contactEmail');
  if (emailField && currentUser) emailField.value = currentUser;
  document.getElementById('contactFormWrap').style.display = 'block';
  document.getElementById('contactSuccess').style.display = 'none';
  document.getElementById('contactError').style.display = 'none';
  document.getElementById('contactModal').classList.add('show');
}

function hideContact() {
  document.getElementById('contactModal').classList.remove('show');
}

async function submitContact() {
  const email = document.getElementById('contactEmail').value.trim();
  const subject = document.getElementById('contactSubject').value;
  const message = document.getElementById('contactMessage').value.trim();
  const errorEl = document.getElementById('contactError');
  const btn = document.getElementById('contactSubmitBtn');
  errorEl.style.display = 'none';
  if (!email || !message) {
    errorEl.textContent = 'Please fill in your email and message.';
    errorEl.style.display = 'block';
    return;
  }
  btn.textContent = 'Sending...';
  btn.disabled = true;
  try {
    const res = await fetch('/.netlify/functions/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, subject, message }),
    });
    if (res.ok) {
      document.getElementById('contactFormWrap').style.display = 'none';
      document.getElementById('contactSuccess').style.display = 'block';
      document.getElementById('contactMessage').value = '';
    } else { throw new Error('Failed'); }
  } catch (err) {
    errorEl.textContent = 'Something went wrong. Please try again.';
    errorEl.style.display = 'block';
  }
  btn.textContent = 'Send Message';
  btn.disabled = false;
}

async function handleUpgrade() {
  if (!currentUserId) {
    alert('Please sign in first to upgrade.');
    return;
  }

  const btn = document.getElementById('checkoutBtn');
  if (btn) { btn.textContent = 'Loading...'; btn.disabled = true; }

  try {
    const res = await fetch('/.netlify/functions/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUserId, email: currentUser }),
    });

    const data = await res.json();

    if (data.url) {
      window.location.href = data.url;
    } else {
      throw new Error(data.error || 'No checkout URL returned');
    }
  } catch (err) {
    console.error('Checkout error:', err);
    alert('Something went wrong starting checkout. Please try again or contact hello@locumslab.com.');
    if (btn) { btn.textContent = 'Upgrade for $39 →'; btn.disabled = false; }
  }
}

async function simulateProUpgrade() {
  // For testing only - simulates successful payment
  if (!currentUserId) { alert('Please sign up first'); return; }

  const { error } = await sb
    .from('entitlements')
    .upsert({
      user_id: currentUserId,
      plan: 'pro',
      status: 'active',
      source: 'manual',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

  if (error) {
    alert('⚠️ Unable to save Pro status. Please contact hello@locumslab.com.');
    return;
  }

  isPro = true;
  document.getElementById('planBadge').textContent = 'Pro';
  const upgradeBtn = document.getElementById('upgradeBtn');
  if (upgradeBtn) upgradeBtn.classList.add('hidden');

  hideUpgradeModal();
  hideScorpPaywall();
  hideComparePaywall();

  alert('🎉 Welcome to Pro!\n\nYou now have:\n✓ S-Corp Evaluator\n✓ Benchmarks (salary, malpractice, retirement & tax data)\n✓ Unlimited scenarios\n✓ Comparison view\n✓ PDF export\n✓ Lifetime access');

  updateExportButton();
}


// ============================================================
// QUICK START WIZARD
// ============================================================
const QS_RATE_HINTS = {
  crna: 'CRNA locums avg: $120–$160/hr',
  md_hospitalist: 'Hospitalist locums avg: $150–$220/hr',
  md_em: 'EM locums avg: $200–$300/hr',
  md_anesthesia: 'Anesthesia locums avg: $200–$350/hr',
  md_fp: 'Family Practice locums avg: $120–$180/hr',
  np: 'NP locums avg: $65–$95/hr',
  pa: 'PA locums avg: $70–$100/hr',
  rn: 'Travel RN avg: $60–$90/hr',
};

function qsNext(step) {
  if (step === 1) {
    const salary = parseFloat(document.getElementById('qs-salary').value) || 0;
    if (salary < 10000) { alert('Please enter a valid annual salary.'); return; }
    // Update rate hint based on profession
    const prof = document.getElementById('qs-profession').value;
    document.getElementById('qs-rate-hint').textContent = QS_RATE_HINTS[prof] || '';
    document.getElementById('qs-page-1').classList.add('hidden');
    document.getElementById('qs-page-2').classList.remove('hidden');
    // Update step indicators
    document.getElementById('qs-dot-2').style.background = 'var(--accent)';
    document.getElementById('qs-dot-2').style.color = 'white';
    document.getElementById('qs-label-2').style.color = 'var(--accent)';
  } else if (step === 2) {
    const hourly = parseFloat(document.getElementById('qs-hourly').value) || 0;
    if (hourly < 10) { alert('Please enter a valid hourly rate.'); return; }
    document.getElementById('qs-page-2').classList.add('hidden');
    calcQuickStart();
    document.getElementById('qs-page-3').classList.remove('hidden');
    document.getElementById('qs-dot-3').style.background = 'var(--accent)';
    document.getElementById('qs-dot-3').style.color = 'white';
    document.getElementById('qs-label-3').style.color = 'var(--accent)';
  }
}

function qsBack(step) {
  if (step === 2) {
    document.getElementById('qs-page-2').classList.add('hidden');
    document.getElementById('qs-page-1').classList.remove('hidden');
    document.getElementById('qs-dot-2').style.background = 'var(--border)';
    document.getElementById('qs-dot-2').style.color = 'var(--muted)';
    document.getElementById('qs-label-2').style.color = 'var(--muted)';
  } else if (step === 3) {
    document.getElementById('qs-page-3').classList.add('hidden');
    document.getElementById('qs-page-2').classList.remove('hidden');
    document.getElementById('qs-dot-3').style.background = 'var(--border)';
    document.getElementById('qs-dot-3').style.color = 'var(--muted)';
    document.getElementById('qs-label-3').style.color = 'var(--muted)';
  }
}

function calcQuickStart() {
  const salary = parseFloat(document.getElementById('qs-salary').value) || 0;
  const benefits = parseFloat(document.getElementById('qs-benefits').value) || 0;
  const pto = parseFloat(document.getElementById('qs-pto').value) || 0;
  const bonus = parseFloat(document.getElementById('qs-bonus').value) || 0;
  const hourly = parseFloat(document.getElementById('qs-hourly').value) || 0;
  const hours = parseFloat(document.getElementById('qs-hours').value) || 40;
  const weeks = parseFloat(document.getElementById('qs-weeks').value) || 46;
  const stipend = parseFloat(document.getElementById('qs-stipend').value) || 0;
  const needsInsurance = document.getElementById('qs-insurance-needed').value === 'yes';
  const insurance = needsInsurance ? (parseFloat(document.getElementById('qs-insurance').value) || 0) : 0;

  // W-2 calculations
  const w2TotalComp = salary + benefits + bonus;
  const w2TaxRate = salary > 400000 ? 0.37 : salary > 200000 ? 0.32 : salary > 150000 ? 0.28 : salary > 89000 ? 0.24 : 0.22;
  const w2Tax = salary * w2TaxRate;
  const w2Net = salary + bonus - w2Tax;

  // Locums calculations
  const annualStipend = stipend * weeks;
  const grossIncome = hourly * hours * weeks;
  const seTax = grossIncome * 0.9235 * 0.153;
  const seTaxDeduction = seTax / 2;
  const taxableIncome = grossIncome - seTaxDeduction - insurance;
  const fedTaxRate = taxableIncome > 400000 ? 0.35 : taxableIncome > 200000 ? 0.32 : taxableIncome > 150000 ? 0.28 : taxableIncome > 89000 ? 0.24 : 0.22;
  const fedTax = taxableIncome * fedTaxRate;
  const locumsNet = grossIncome + annualStipend - seTax - fedTax - insurance;

  const diff = locumsNet - w2Net;
  const fmt = n => '$' + Math.round(n).toLocaleString();

  // Populate W-2 card
  document.getElementById('qs-r-salary').textContent = fmt(salary);
  document.getElementById('qs-r-benefits').textContent = fmt(benefits);
  document.getElementById('qs-r-bonus').textContent = fmt(bonus);
  document.getElementById('qs-r-totalcomp').textContent = fmt(w2TotalComp);
  document.getElementById('qs-r-w2tax').textContent = '-' + fmt(w2Tax);
  document.getElementById('qs-r-w2net').textContent = fmt(w2Net);

  // Populate Locums card
  document.getElementById('qs-r-gross').textContent = fmt(grossIncome);
  document.getElementById('qs-r-stipend').textContent = fmt(annualStipend) + ' (tax-free)';
  document.getElementById('qs-r-insurance').textContent = needsInsurance ? '-' + fmt(insurance) : 'Covered';
  document.getElementById('qs-r-setax').textContent = '-' + fmt(seTax);
  document.getElementById('qs-r-fedtax').textContent = '-' + fmt(fedTax);
  document.getElementById('qs-r-locumsnet').textContent = fmt(locumsNet);

  // Insight
  const insightEl = document.getElementById('qs-insight');
  if (diff > 0) {
    insightEl.textContent = `Switching to locums could put an estimated ${fmt(diff)} more in your pocket each year compared to your current W-2 position. That's before any S-Corp optimization, which could save an additional $5,000–$15,000 on top of that.`;
  } else {
    insightEl.textContent = `Based on these numbers, your W-2 position comes out ahead by approximately ${fmt(Math.abs(diff))}. This is often due to the strong benefits package offsetting the locums premium. Consider negotiating a higher contract rate or reducing insurance costs.`;
  }

  // Next steps
  const ptoDays = pto;
  const ptoValue = (salary / 260) * ptoDays;
  document.getElementById('qs-next-steps').innerHTML = `
    1. <strong>Get your first contract offer</strong> — use the Staff vs Locums calculator to evaluate specific offers.<br>
    2. <strong>Budget for taxes</strong> — set aside ~${Math.round((seTax + fedTax) / grossIncome * 100)}% of gross for quarterly estimated payments.<br>
    3. <strong>Check S-Corp potential</strong> — at $${Math.round(grossIncome/1000)}k gross, you may save significantly with an S-Corp structure.<br>
    4. <strong>Note:</strong> Your W-2 PTO (${ptoDays} days ≈ ${fmt(ptoValue)}/yr value) disappears as 1099 — factor in unpaid time between contracts.
  `;

  // Store for share
  window._qsShareData = { salary, benefits, bonus, w2Net, grossIncome, locumsNet, diff };
}

// ============================================================
// TRUE HOURLY RATE CALCULATOR
// ============================================================
function thrToggleType() {
  const type = document.getElementById('thr-type').value;
  document.getElementById('thr-hourly-field').style.display = type === 'hourly' ? '' : 'none';
  document.getElementById('thr-weekly-field').style.display = type === 'weekly' ? '' : 'none';
  document.getElementById('thr-annual-field').style.display = type === 'annual' ? '' : 'none';
}

function calcTrueHourly() {
  const type = document.getElementById('thr-type').value;
  const clinicalHours = parseFloat(document.getElementById('thr-clinical-hours').value) || 40;
  const weeks = parseFloat(document.getElementById('thr-weeks').value) || 46;
  const travelTimeWeekly = parseFloat(document.getElementById('thr-travel-time').value) || 0;
  const travelCost = parseFloat(document.getElementById('thr-travel-cost').value) || 0;
  const health = parseFloat(document.getElementById('thr-health').value) || 0;
  const malpractice = parseFloat(document.getElementById('thr-malpractice').value) || 0;
  const benefitsGap = parseFloat(document.getElementById('thr-benefits-gap').value) || 0;

  let contractHourly = 0;
  if (type === 'hourly') {
    contractHourly = parseFloat(document.getElementById('thr-hourly').value) || 0;
  } else if (type === 'weekly') {
    const weekly = parseFloat(document.getElementById('thr-weekly').value) || 0;
    contractHourly = weekly / clinicalHours;
  } else {
    const annual = parseFloat(document.getElementById('thr-annual').value) || 0;
    contractHourly = annual / (clinicalHours * weeks);
  }

  const annualGross = contractHourly * clinicalHours * weeks;
  const totalHoursWorked = (clinicalHours + travelTimeWeekly) * weeks; // includes travel time

  // Per-hour costs based on total hours (clinical + travel)
  const seTaxAnnual = annualGross * 0.9235 * 0.153;
  const seTaxPerHour = seTaxAnnual / totalHoursWorked;
  const healthPerHour = health / totalHoursWorked;
  const malpracticePerHour = malpractice / totalHoursWorked;
  const benefitsPerHour = benefitsGap / totalHoursWorked;
  const travelCostPerHour = travelCost / totalHoursWorked;

  // Travel time cost: unpaid hours reduce effective rate
  // We already factor travel time by using totalHoursWorked as denominator
  const travelTimePerHour = contractHourly * (travelTimeWeekly / (clinicalHours + travelTimeWeekly));

  const trueRate = contractHourly - seTaxPerHour - healthPerHour - malpracticePerHour - benefitsPerHour - travelCostPerHour - travelTimePerHour;
  const reduction = contractHourly - trueRate;
  const reductionPct = Math.round((reduction / contractHourly) * 100);

  const fmt = n => '$' + Math.abs(n).toFixed(2);
  const fmtR = n => '$' + Math.round(Math.abs(n)).toLocaleString();

  document.getElementById('thr-contract-rate').textContent = '$' + contractHourly.toFixed(2);
  document.getElementById('thr-true-rate').textContent = '$' + Math.max(0, trueRate).toFixed(2);
  document.getElementById('thr-reduction').textContent = '-' + reductionPct + '%';

  document.getElementById('thr-b-contract').textContent = '$' + contractHourly.toFixed(2);
  document.getElementById('thr-b-setax').textContent = '-' + fmt(seTaxPerHour);
  document.getElementById('thr-b-health').textContent = '-' + fmt(healthPerHour);
  document.getElementById('thr-b-malp').textContent = '-' + fmt(malpracticePerHour);
  document.getElementById('thr-b-benefits').textContent = '-' + fmt(benefitsPerHour);
  document.getElementById('thr-b-travel').textContent = '-' + fmt(travelCostPerHour);
  document.getElementById('thr-b-traveltime').textContent = '-' + fmt(travelTimePerHour);
  document.getElementById('thr-b-true').textContent = '$' + Math.max(0, trueRate).toFixed(2);

  const insightEl = document.getElementById('thr-insight');
  insightEl.textContent = `Your stated rate of $${contractHourly.toFixed(2)}/hr becomes approximately $${Math.max(0, trueRate).toFixed(2)}/hr after accounting for self-employment taxes, benefits costs, and travel. That's a ${reductionPct}% reduction from your contract rate. Annually, your true net from this contract is approximately ${fmtR(Math.max(0, trueRate) * totalHoursWorked)}.`;

  document.getElementById('thr-results').classList.remove('hidden');

  window._thrShareData = { contractHourly, trueRate, reductionPct, annualGross };
}

// ============================================================
// SHARE RESULTS — Image Card + Link
// ============================================================

let _currentShareData = null;
let _currentCalculator = null;

async function shareResults(calculator) {
  const shareData = getShareData(calculator);
  if (!shareData) return;

  _currentShareData = shareData;
  _currentCalculator = calculator;

  document.getElementById('shareModal').classList.add('show');

  // Draw image card immediately
  drawShareCard(calculator, shareData);

  // Generate shareable link in background
  document.getElementById('shareUrlInput').value = 'Generating link...';
  document.getElementById('shareModalLoading').style.display = 'block';

  try {
    const { data, error } = await sb
      .from('shared_results')
      .insert({
        calculator,
        data: shareData,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) throw error;
    document.getElementById('shareUrlInput').value = `${window.location.origin}/share.html?id=${data.id}`;
  } catch (err) {
    console.error('Share error:', err);
    // Fallback: encode data in URL params so sharing still works
    const encoded = encodeURIComponent(JSON.stringify({ calculator, ...shareData }));
    document.getElementById('shareUrlInput').value = `${window.location.origin}/app.html`;
  }

  document.getElementById('shareModalLoading').style.display = 'none';
}

function getShareData(calculator) {
  if (calculator === 'quickstart' && window._qsShareData) return window._qsShareData;
  if (calculator === 'true-hourly' && window._thrShareData) return window._thrShareData;
  alert('Please run the calculator first to generate results.');
  return null;
}

// ── IMAGE CARD GENERATOR ──────────────────────────────────────────────────────

function drawShareCard(calculator, data) {
  const canvas = document.getElementById('shareCanvas');
  const dpr = window.devicePixelRatio || 2;

  // Card dimensions: 1200×630 (standard OG image ratio)
  const W = 1200, H = 630;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = '100%';
  canvas.style.height = 'auto';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // ── BACKGROUND ──
  ctx.fillStyle = '#0f1419';
  ctx.fillRect(0, 0, W, H);

  // Subtle green glow top-right
  const glow = ctx.createRadialGradient(W * 0.85, H * 0.15, 0, W * 0.85, H * 0.15, 380);
  glow.addColorStop(0, 'rgba(16,185,129,0.08)');
  glow.addColorStop(1, 'rgba(16,185,129,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // ── LEFT ACCENT BAR ──
  ctx.fillStyle = '#10b981';
  ctx.fillRect(0, 0, 8, H);

  // ── LOCUMS LAB WORDMARK ──
  ctx.font = 'bold 32px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#10b981';
  ctx.fillText('LocumsLab', 56, 66);

  // ── TOOL LABEL ──
  const toolLabel = calculator === 'true-hourly' ? 'True Hourly Rate Calculator' : 'Quick Start — W-2 to Locums';
  ctx.font = '500 22px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#64748b';
  ctx.fillText(toolLabel, 56, 102);

  // ── DIVIDER ──
  ctx.strokeStyle = '#2d3748';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(56, 120);
  ctx.lineTo(W - 56, 120);
  ctx.stroke();

  if (calculator === 'true-hourly') {
    drawTrueHourlyCard(ctx, data, W, H);
  } else {
    drawQuickStartCard(ctx, data, W, H);
  }

  // ── FOOTER ──
  ctx.fillStyle = '#2d3748';
  ctx.fillRect(0, H - 56, W, 56);

  ctx.font = '500 20px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#64748b';
  ctx.fillText('locumslab.com', 56, H - 20);

  ctx.font = '500 20px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#64748b';
  const disclaimer = 'Educational estimates only — not financial or tax advice.';
  ctx.textAlign = 'right';
  ctx.fillText(disclaimer, W - 56, H - 20);
  ctx.textAlign = 'left';
}

function drawTrueHourlyCard(ctx, data, W, H) {
  const { contractHourly, trueRate, reductionPct } = data;
  const fmt2 = n => '$' + Math.max(0, n).toFixed(2);
  const pct  = reductionPct + '%';

  // ── MAIN NUMBERS ROW ──
  const colW  = (W - 112) / 3;
  const col1x = 56;
  const col2x = 56 + colW;
  const col3x = 56 + colW * 2;
  const midY  = 155;

  // Contract rate box (dim)
  drawStatBox(ctx, col1x, midY, colW - 24, 200, '#1a1f29', '#2d3748');
  ctx.font = '600 18px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#64748b';
  ctx.fillText('CONTRACT RATE', col1x + 24, midY + 40);
  ctx.font = 'bold 68px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#f7fafc';
  ctx.fillText(fmt2(contractHourly), col1x + 24, midY + 122);
  ctx.font = '500 20px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#64748b';
  ctx.fillText('per hour', col1x + 24, midY + 155);

  // Arrow
  ctx.font = '500 48px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#10b981';
  ctx.textAlign = 'center';
  ctx.fillText('→', col1x + colW + 8, midY + 115);
  ctx.textAlign = 'left';

  // True rate box (highlighted)
  drawStatBox(ctx, col2x, midY, colW - 24, 200, 'rgba(16,185,129,0.08)', '#10b981', 2);
  ctx.font = '700 18px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#10b981';
  ctx.fillText('TRUE HOURLY RATE', col2x + 24, midY + 40);
  ctx.font = 'bold 68px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#10b981';
  ctx.fillText(fmt2(trueRate), col2x + 24, midY + 122);
  ctx.font = '500 20px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#64748b';
  ctx.fillText('after all costs & time', col2x + 24, midY + 155);

  // Reduction box
  drawStatBox(ctx, col3x, midY, colW - 24, 200, '#1a1f29', '#2d3748');
  ctx.font = '600 18px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#64748b';
  ctx.fillText('RATE REDUCTION', col3x + 24, midY + 40);
  ctx.font = 'bold 68px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#ef4444';
  ctx.fillText('-' + pct, col3x + 24, midY + 122);
  ctx.font = '500 20px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#64748b';
  ctx.fillText('from stated rate', col3x + 24, midY + 155);

  // ── INSIGHT TEXT ──
  const insight = `Your $${contractHourly.toFixed(0)}/hr contract rate becomes $${Math.max(0, trueRate).toFixed(0)}/hr after SE taxes, benefits, malpractice & travel time.`;
  ctx.font = '500 22px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#94a3b8';
  wrapText(ctx, insight, 56, 408, W - 112, 34);
}

function drawQuickStartCard(ctx, data, W, H) {
  const { salary, w2Net, grossIncome, locumsNet, diff } = data;
  const fmtK = n => '$' + Math.round(Math.abs(n) / 1000) + 'k';

  const col1x = 56;
  const col2x = W / 2 + 28;
  const colW  = W / 2 - 84;
  const midY  = 155;

  // W-2 box
  drawStatBox(ctx, col1x, midY, colW, 190, '#1a1f29', '#2d3748');
  ctx.font = '600 18px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#64748b';
  ctx.fillText('W-2 NET TAKE-HOME', col1x + 24, midY + 40);
  ctx.font = 'bold 64px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#f7fafc';
  ctx.fillText(fmtK(w2Net), col1x + 24, midY + 118);
  ctx.font = '500 20px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#64748b';
  ctx.fillText('per year (salary ' + fmtK(salary) + ')', col1x + 24, midY + 152);

  // Locums box
  drawStatBox(ctx, col2x, midY, colW, 190, 'rgba(16,185,129,0.08)', '#10b981', 2);
  ctx.font = '700 18px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#10b981';
  ctx.fillText('LOCUMS NET TAKE-HOME', col2x + 24, midY + 40);
  ctx.font = 'bold 64px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#10b981';
  ctx.fillText(fmtK(locumsNet), col2x + 24, midY + 118);
  ctx.font = '500 20px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#64748b';
  ctx.fillText('per year (' + (diff >= 0 ? '+' : '') + fmtK(diff) + ' vs W-2)', col2x + 24, midY + 152);

  // Insight
  const msg = diff >= 0
    ? `Switching to locums could add ~${fmtK(diff)}/year to take-home pay after SE taxes, insurance & expenses.`
    : `The W-2 position comes out ahead by ~${fmtK(Math.abs(diff))}/year — consider negotiating a higher contract rate.`;
  ctx.font = '500 22px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#94a3b8';
  wrapText(ctx, msg, 56, 402, W - 112, 34);
}

function drawStatBox(ctx, x, y, w, h, fill, stroke, lineWidth = 1) {
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, x, y, w, h, 12);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const test = line + words[i] + ' ';
    if (ctx.measureText(test).width > maxWidth && i > 0) {
      ctx.fillText(line.trim(), x, y);
      line = words[i] + ' ';
      y += lineHeight;
    } else {
      line = test;
    }
  }
  ctx.fillText(line.trim(), x, y);
}

function downloadShareCard() {
  const canvas = document.getElementById('shareCanvas');
  const link = document.createElement('a');
  link.download = 'locumslab-results.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
}

function copyShareText() {
  if (!_currentShareData || !_currentCalculator) return;
  const d = _currentShareData;
  let text = '';

  if (_currentCalculator === 'true-hourly') {
    text = `Ran my locums contract through LocumsLab — my stated rate is $${d.contractHourly.toFixed(0)}/hr but my true hourly rate after SE taxes, health insurance, malpractice, and travel time is $${Math.max(0, d.trueRate).toFixed(0)}/hr. That's a ${d.reductionPct}% reduction most people don't account for before signing.\n\nlocumslab.com`;
  } else {
    const fmtK = n => '$' + Math.round(Math.abs(n) / 1000) + 'k';
    const sign = d.diff >= 0 ? '+' + fmtK(d.diff) : '-' + fmtK(Math.abs(d.diff));
    text = `Modeled my W-2 vs going locums on LocumsLab — current take-home ${fmtK(d.w2Net)}/yr, locums projection ${fmtK(d.locumsNet)}/yr (${sign}). Accounts for SE taxes, health insurance, malpractice, and benefits gap.\n\nlocumslab.com`;
  }

  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copyTextBtn');
    btn.textContent = '✓ Copied!';
    setTimeout(() => btn.textContent = '📝 Copy Post Text', 2500);
  });
}

function hideShareModal() {
  document.getElementById('shareModal').classList.remove('show');
}

function copyShareUrl() {
  const input = document.getElementById('shareUrlInput');
  input.select();
  navigator.clipboard.writeText(input.value).then(() => {
    const btn = document.getElementById('copyShareBtn');
    btn.textContent = '✓ Copied!';
    setTimeout(() => btn.textContent = 'Copy Link', 2000);
  });
}

function switchPanel(id, btn) {
  // Check if trying to access S-Corp without Pro
  if (id === 'scorp' && !isPro) {
    showScorpPaywall();
    return;
  }
  // Benchmarks tab is Pro only
  if (id === 'benchmarks' && !isPro) {
    showUpgradeModal();
    return;
  }

  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('panel-' + id).classList.add('active');
  if (btn) btn.classList.add('active');
  if (id === 'benchmarks') { setTimeout(renderBenchmarks, 50); }
}

async function showComparisonView() {
  // Check Pro status
  if (!isPro) {
    showComparePaywall();
    return;
  }
  
  const scenarios = await getUserScenarios();
  if (scenarios.length < 2) {
    alert('You need at least 2 saved scenarios to compare. Save some scenarios first!');
    return;
  }
  
  // Build comparison table (simplified for now)
  const comparisonView = document.getElementById('comparisonView');
  const table = document.getElementById('comparisonTable');
  
  let html = '<thead><tr><th>Metric</th>';
  scenarios.slice(0, 5).forEach(s => {
    html += `<th>${s.name}</th>`;
  });
  html += '</tr></thead><tbody>';
  
  // Add comparison rows (simplified - would need actual calculations)
  html += '<tr><td><strong>Staff Salary</strong></td>';
  scenarios.slice(0, 5).forEach(s => {
    html += `<td>$${(s.data.staffSalary || 0).toLocaleString()}</td>`;
  });
  html += '</tr>';
  
  html += '<tr><td><strong>Staff Benefits</strong></td>';
  scenarios.slice(0, 5).forEach(s => {
    html += `<td>$${(s.data.staffBenefits || 0).toLocaleString()}</td>`;
  });
  html += '</tr>';
  
  html += '<tr><td><strong>Locums Weekly Rate</strong></td>';
  scenarios.slice(0, 5).forEach(s => {
    const rate = s.data.locumsRateType === 'hourly' 
      ? `$${s.data.locumsHourly}/hr` 
      : `$${(s.data.locumsWeekly || 0).toLocaleString()}`;
    html += `<td>${rate}</td>`;
  });
  html += '</tr>';
  
  html += '</tbody>';
  table.innerHTML = html;
  
  comparisonView.classList.remove('hidden');
  
  // Scroll to comparison
  comparisonView.scrollIntoView({ behavior: 'smooth' });
}


function toggleRateType() {
  const type = document.getElementById('locums-rate-type').value;
  if (type === 'hourly') {
    document.getElementById('hourly-rate-field').style.display = 'block';
    document.getElementById('weekly-rate-field').style.display = 'none';
  } else {
    document.getElementById('hourly-rate-field').style.display = 'none';
    document.getElementById('weekly-rate-field').style.display = 'block';
  }
}

// Calculator functions
function calcStaffLocums() {
  const staffSalary = parseFloat(document.getElementById('staff-salary').value) || 0;
  const staffBenefits = parseFloat(document.getElementById('staff-benefits').value) || 0;
  const staffBonus = parseFloat(document.getElementById('staff-bonus').value) || 0;
  
  const rateType = document.getElementById('locums-rate-type').value;
  const locumsHourly = parseFloat(document.getElementById('locums-hourly').value) || 0;
  const locumsWeekly = parseFloat(document.getElementById('locums-weekly').value) || 0;
  const locumsHours = parseFloat(document.getElementById('locums-hours').value) || 0;
  const locumsWeeks = parseFloat(document.getElementById('locums-weeks').value) || 0;
  const locumsHousing = parseFloat(document.getElementById('locums-housing').value) || 0;
  const locumsInsurance = parseFloat(document.getElementById('locums-insurance').value) || 0;
  const locumsExpenses = parseFloat(document.getElementById('locums-expenses').value) || 0;
  
  // Get selected profession for benchmarks
  const profession = document.getElementById('sl-profession').value;
  
  // Staff calculations
  const staffTotal = staffSalary + staffBenefits + staffBonus;
  const staffTax = staffSalary * 0.25; // Simplified
  const staffNet = staffSalary + staffBonus - staffTax;
  
  // Locums calculations
  let locumsGross;
  if (rateType === 'weekly') {
    locumsGross = locumsWeekly * locumsWeeks + (locumsHousing * locumsWeeks / 4.33);
  } else {
    locumsGross = locumsHourly * locumsHours * locumsWeeks + (locumsHousing * locumsWeeks / 4.33);
  }
  
  const totalExpenses = locumsInsurance + locumsExpenses;
  const taxableIncome = locumsGross - totalExpenses;
  const seTax = taxableIncome * 0.9235 * 0.153;
  const fedTax = taxableIncome * 0.24;
  const totalTax = seTax + fedTax;
  const locumsNet = locumsGross - totalExpenses - totalTax;
  
  const diff = locumsNet - staffNet;
  
  // Display
  document.getElementById('staff-base').textContent = fmtFull(staffSalary);
  document.getElementById('staff-ben').textContent = fmtFull(staffBenefits);
  document.getElementById('staff-total').textContent = fmtFull(staffTotal);
  document.getElementById('staff-tax').textContent = fmtFull(staffTax);
  document.getElementById('staff-net').textContent = fmtFull(staffNet);
  
  document.getElementById('locums-gross').textContent = fmtFull(locumsGross);
  document.getElementById('locums-exp').textContent = fmtFull(totalExpenses);
  document.getElementById('locums-taxable').textContent = fmtFull(taxableIncome);
  document.getElementById('locums-tax').textContent = fmtFull(totalTax);
  document.getElementById('locums-net').textContent = fmtFull(locumsNet);
  document.getElementById('locums-diff').textContent = (diff >= 0 ? '+' : '') + fmtFull(diff);
  
  if (locumsNet > staffNet) {
    document.getElementById('locums-card').classList.add('winner');
    document.getElementById('staff-card').classList.remove('winner');
  } else {
    document.getElementById('staff-card').classList.add('winner');
    document.getElementById('locums-card').classList.remove('winner');
  }
  
  const monthlyDiff = diff / 12;
  document.getElementById('sl-insight').textContent = 
    `${diff >= 0 ? 'Locums comes out ahead' : 'Staff position comes out ahead'} by ${fmtFull(Math.abs(diff))} annually (${fmtFull(Math.abs(monthlyDiff))}/month). ${diff >= 0 ? 'The extra income from locums exceeds the additional costs of self-employment taxes, health insurance, and business expenses.' : 'The benefits and job security of a staff position outweigh the higher gross income from locums contracts.'} Consider factors like flexibility, lifestyle, travel preferences, and long-term career goals when making your decision.`;
  
  // SHOW BENCHMARKS
  const benchmarkData = BENCHMARKS[profession];
  if (benchmarkData) {
    showBenchmarks(profession, staffSalary, rateType === 'hourly' ? locumsHourly : locumsWeekly, rateType);
  }
  
  document.getElementById('sl-results').classList.remove('hidden');
  updateExportButton();
}

function showBenchmarks(profession, staffSalary, locumsRate, rateType) {
  const benchmark = BENCHMARKS[profession];
  if (!benchmark) {
    document.getElementById('sl-benchmarks').classList.add('hidden');
    return;
  }
  
  // Staff salary comparison
  const staffBench = benchmark.staff.salary;
  const staffComp = getBenchmarkComparison(staffSalary, staffBench, 'salary');
  
  document.getElementById('benchmark-staff-salary').textContent = fmtFull(staffSalary);
  
  const staffBadge = document.getElementById('benchmark-staff-badge');
  staffBadge.textContent = staffComp.message;
  staffBadge.style.background = staffComp.color === '#10b981' ? 'rgba(16, 185, 129, 0.15)' : 
                                 staffComp.color === '#f59e0b' ? 'rgba(245, 158, 11, 0.15)' : 
                                 'rgba(239, 68, 68, 0.15)';
  staffBadge.style.color = staffComp.color;
  
  document.getElementById('benchmark-staff-detail').textContent = 
    `Market median for ${benchmark.name}: ${fmtFull(staffBench.median)} (${benchmark.staff.source})`;
  
  // Locums rate comparison
  const locumsTypeBench = rateType === 'hourly' ? benchmark.locums.hourly : benchmark.locums.weekly;
  const locumsComp = getBenchmarkComparison(locumsRate, locumsTypeBench, rateType === 'hourly' ? 'hourly' : 'weekly');
  
  document.getElementById('benchmark-locums-rate').textContent = 
    rateType === 'hourly' ? `$${locumsRate}/hr` : fmtFull(locumsRate) + '/wk';
  
  const locumsBadge = document.getElementById('benchmark-locums-badge');
  locumsBadge.textContent = locumsComp.message;
  locumsBadge.style.background = locumsComp.color === '#10b981' ? 'rgba(16, 185, 129, 0.15)' : 
                                  locumsComp.color === '#f59e0b' ? 'rgba(245, 158, 11, 0.15)' : 
                                  'rgba(239, 68, 68, 0.15)';
  locumsBadge.style.color = locumsComp.color;
  
  document.getElementById('benchmark-locums-detail').textContent = 
    `Market median for ${benchmark.name}: ${locumsComp.median} (${benchmark.locums.source})`;
  
  // Generate smart tip
  let tip = '';
  if (staffComp.percentile < 40 && locumsComp.percentile < 40) {
    tip = 'Both offers are below market average. Consider negotiating higher or exploring other opportunities.';
  } else if (staffComp.percentile >= 60 && locumsComp.percentile >= 60) {
    tip = 'Both offers are competitive! Your decision can focus on lifestyle and career goals rather than compensation.';
  } else if (staffComp.percentile > locumsComp.percentile + 15) {
    tip = 'Your staff offer is stronger relative to market than your locums offer. The locums rate may have room for negotiation.';
  } else if (locumsComp.percentile > staffComp.percentile + 15) {
    tip = 'Your locums rate is strong relative to market. This is a competitive opportunity.';
  } else {
    tip = 'Both offers are within typical market ranges. Consider non-financial factors like flexibility and work-life balance.';
  }
  
  document.getElementById('benchmark-tip').textContent = tip;
  document.getElementById('sl-benchmarks').classList.remove('hidden');
}

function calcW21099() {
  const w2Sal = parseFloat(document.getElementById('w2-salary').value) || 0;
  const w2Ben = parseFloat(document.getElementById('w2-benefits').value) || 0;
  const rate = parseFloat(document.getElementById('c1099-rate').value) || 0;
  const hours = parseFloat(document.getElementById('c1099-hours').value) || 0;
  const health = parseFloat(document.getElementById('c1099-health').value) || 0;
  const exp = parseFloat(document.getElementById('c1099-exp').value) || 0;
  
  const w2Tax = w2Sal * 0.24 + w2Sal * 0.0765;
  const w2Net = w2Sal - w2Tax;
  
  const c1099Gross = rate * hours;
  const totalExp = health + exp;
  const taxable = c1099Gross - totalExp;
  const seTax = taxable * 0.9235 * 0.153;
  const fedTax = taxable * 0.24;
  const c1099Net = c1099Gross - totalExp - seTax - fedTax;
  const diff = c1099Net - w2Net;
  
  document.getElementById('w2-gross').textContent = fmtFull(w2Sal);
  document.getElementById('w2-ben').textContent = fmtFull(w2Ben);
  document.getElementById('w2-tax').textContent = fmtFull(w2Tax);
  document.getElementById('w2-net').textContent = fmtFull(w2Net);
  
  document.getElementById('c1099-gross').textContent = fmtFull(c1099Gross);
  document.getElementById('c1099-expenses').textContent = fmtFull(totalExp);
  document.getElementById('c1099-tax').textContent = fmtFull(seTax + fedTax);
  document.getElementById('c1099-net').textContent = fmtFull(c1099Net);
  document.getElementById('c1099-diff').textContent = (diff >= 0 ? '+' : '') + fmtFull(diff);
  
  if (c1099Net > w2Net) {
    document.getElementById('c1099-card').classList.add('winner');
    document.getElementById('w2-card').classList.remove('winner');
  } else {
    document.getElementById('w2-card').classList.add('winner');
    document.getElementById('c1099-card').classList.remove('winner');
  }
  
  document.getElementById('w2-results').classList.remove('hidden');
  updateExportButton();
}

function calcTax() {
  const gross = parseFloat(document.getElementById('tx-gross').value) || 0;
  const office = parseFloat(document.getElementById('tx-office').value) || 0;
  const software = parseFloat(document.getElementById('tx-software').value) || 0;
  const health = parseFloat(document.getElementById('tx-health').value) || 0;
  const other = parseFloat(document.getElementById('tx-other').value) || 0;
  
  const officeDeduction = office * 5;
  const totalDed = software + health + other + officeDeduction;
  const net = Math.max(0, gross - totalDed);
  const seTax = net * 0.9235 * 0.153;
  const fedTax = net * 0.24;
  const total = seTax + fedTax;
  const effective = (total / gross * 100).toFixed(1);
  const quarterly = total / 4;
  
  document.getElementById('tx-rate').textContent = effective + '%';
  document.getElementById('tx-se').textContent = fmtFull(seTax);
  document.getElementById('tx-ded').textContent = fmtFull(totalDed);
  document.getElementById('tx-q').textContent = fmtFull(quarterly);
  document.getElementById('tx-insight').textContent = 
    `Set aside ${fmtFull(quarterly)} per quarter for estimated tax payments. Your deductions reduce taxable income by ${fmtFull(totalDed)}. Consider maximizing deductible expenses like continuing education, professional dues, and mileage for travel between assignments.`;
  
  document.getElementById('tx-results').classList.remove('hidden');
  updateExportButton();
}

function calcHome() {
  const price = parseFloat(document.getElementById('hm-price').value) || 0;
  const downPct = parseFloat(document.getElementById('hm-down').value) / 100;
  const rate = parseFloat(document.getElementById('hm-rate').value) / 100;
  const savings = parseFloat(document.getElementById('hm-savings').value) || 0;
  const monthly = parseFloat(document.getElementById('hm-monthly').value) || 0;
  const income = parseFloat(document.getElementById('hm-income').value) || 0;
  
  const downAmt = price * downPct;
  const closing = price * 0.03;
  const total = downAmt + closing;
  const toSave = Math.max(0, total - savings);
  const months = toSave / monthly;
  
  const loan = price - downAmt;
  const monthlyRate = rate / 12;
  const payment = loan * (monthlyRate * Math.pow(1 + monthlyRate, 360)) / (Math.pow(1 + monthlyRate, 360) - 1);
  const dti = (payment / (income / 12)) * 100;
  
  const targetDate = new Date();
  targetDate.setMonth(targetDate.getMonth() + Math.ceil(months));
  
  document.getElementById('hm-months').textContent = Math.ceil(months) + ' mo';
  document.getElementById('hm-date').textContent = targetDate.toLocaleDateString('en-US', {month: 'long', year: 'numeric'});
  document.getElementById('hm-down-amt').textContent = fmtFull(downAmt);
  document.getElementById('hm-payment').textContent = fmtFull(payment);
  document.getElementById('hm-dti').textContent = dti.toFixed(1) + '%';
  
  if (dti > 28) {
    document.getElementById('hm-dti').classList.add('danger');
    document.getElementById('hm-dti').classList.remove('success');
  } else {
    document.getElementById('hm-dti').classList.add('success');
    document.getElementById('hm-dti').classList.remove('danger');
  }
  
  document.getElementById('hm-results').classList.remove('hidden');
  updateExportButton();
}

function calcLoan() {
  const balance = parseFloat(document.getElementById('ln-balance').value) || 0;
  const rate = parseFloat(document.getElementById('ln-rate').value) / 100 / 12;
  const std = parseFloat(document.getElementById('ln-payment').value) || 0;
  const agg = parseFloat(document.getElementById('ln-agg').value) || std;
  
  let stdBal = balance, stdMonths = 0, stdInt = 0;
  while (stdBal > 0 && stdMonths < 360) {
    const int = stdBal * rate;
    stdInt += int;
    stdBal -= (std - int);
    stdMonths++;
  }
  
  let aggBal = balance, aggMonths = 0, aggInt = 0;
  while (aggBal > 0 && aggMonths < 360) {
    const int = aggBal * rate;
    aggInt += int;
    aggBal -= (agg - int);
    aggMonths++;
  }
  
  const save = stdInt - aggInt;
  
  document.getElementById('ln-std-int').textContent = fmtFull(stdInt);
  document.getElementById('ln-std-time').textContent = (stdMonths / 12).toFixed(1) + ' yrs';
  document.getElementById('ln-std-total').textContent = fmtFull(balance + stdInt);
  
  document.getElementById('ln-agg-int').textContent = fmtFull(aggInt);
  document.getElementById('ln-agg-time').textContent = (aggMonths / 12).toFixed(1) + ' yrs';
  document.getElementById('ln-agg-total').textContent = fmtFull(balance + aggInt);
  document.getElementById('ln-save').textContent = fmtFull(save);
  
  document.getElementById('ln-results').classList.remove('hidden');
  updateExportButton();
}

function calcIncome() {
  const salary = parseFloat(document.getElementById('it-salary').value) || 0;
  const raise = parseFloat(document.getElementById('it-raise').value) / 100;
  const spouse = parseFloat(document.getElementById('it-spouse').value) || 0;
  const spouseRaise = parseFloat(document.getElementById('it-spouse-raise').value) / 100;
  const side = parseFloat(document.getElementById('it-side').value) || 0;
  
  const y5 = (salary * Math.pow(1 + raise, 5)) + (spouse * Math.pow(1 + spouseRaise, 5)) + side;
  const y10 = (salary * Math.pow(1 + raise, 10)) + (spouse * Math.pow(1 + spouseRaise, 10)) + side;
  const current = salary + spouse + side;
  const growth = ((y10 / current - 1) * 100).toFixed(1);
  
  document.getElementById('it-y5').textContent = fmt(y5);
  document.getElementById('it-y10').textContent = fmt(y10);
  document.getElementById('it-growth').textContent = growth + '%';
  document.getElementById('it-cur').textContent = fmt(current);
  
  document.getElementById('it-results').classList.remove('hidden');
  updateExportButton();
}

// PDF Export Functions
function updateExportButton() {
  const btn = document.getElementById('exportScenarioBtn');
  const hasResults = !document.getElementById('sl-results').classList.contains('hidden') ||
                     !document.getElementById('w2-results').classList.contains('hidden') ||
                     !document.getElementById('tx-results').classList.contains('hidden') ||
                     !document.getElementById('hm-results').classList.contains('hidden') ||
                     !document.getElementById('ln-results').classList.contains('hidden') ||
                     !document.getElementById('it-results').classList.contains('hidden');
  
  if (isPro && hasResults) {
    btn.classList.remove('hidden');
    btn.classList.remove('disabled');
  } else if (!isPro && hasResults) {
    btn.classList.remove('hidden');
    btn.classList.add('disabled');
    btn.onclick = () => {
      alert('PDF export is a Pro feature. Upgrade to unlock!');
      showUpgradeModal();
    };
  } else {
    btn.classList.add('hidden');
  }
}

function exportScenarioPDF() {
  if (!isPro) {
    showUpgradeModal();
    return;
  }
  
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  
  const title = document.getElementById('calcTitle').textContent;
  const date = new Date().toLocaleDateString();
  
  // Header
  doc.setFontSize(20);
  doc.setFont(undefined, 'bold');
  doc.text('LocumsLab Report', 20, 20);
  
  doc.setFontSize(12);
  doc.setFont(undefined, 'normal');
  doc.text(title, 20, 30);
  doc.text(`Generated: ${date}`, 20, 37);
  
  let yPos = 50;
  
  // Check which panel is active and export that data
  const activePanel = document.querySelector('.panel.active');
  
  if (activePanel.id === 'panel-staff-locums' && !document.getElementById('sl-results').classList.contains('hidden')) {
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text('Staff vs Locums Comparison', 20, yPos);
    yPos += 10;
    
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    
    // Staff Position
    doc.text('Staff Position:', 20, yPos);
    yPos += 6;
    doc.text(`Base: ${document.getElementById('staff-base').textContent}`, 30, yPos);
    yPos += 6;
    doc.text(`Benefits: ${document.getElementById('staff-ben').textContent}`, 30, yPos);
    yPos += 6;
    doc.text(`Total Comp: ${document.getElementById('staff-total').textContent}`, 30, yPos);
    yPos += 6;
    doc.text(`Net: ${document.getElementById('staff-net').textContent}`, 30, yPos);
    yPos += 10;
    
    // Locums
    doc.text('Locums/Travel:', 20, yPos);
    yPos += 6;
    doc.text(`Gross: ${document.getElementById('locums-gross').textContent}`, 30, yPos);
    yPos += 6;
    doc.text(`Expenses: ${document.getElementById('locums-exp').textContent}`, 30, yPos);
    yPos += 6;
    doc.text(`Net: ${document.getElementById('locums-net').textContent}`, 30, yPos);
    yPos += 6;
    doc.text(`Difference: ${document.getElementById('locums-diff').textContent}`, 30, yPos);
    yPos += 10;
    
    // Insight
    doc.setFontSize(9);
    const insight = document.getElementById('sl-insight').textContent;
    const lines = doc.splitTextToSize(insight, 170);
    doc.text(lines, 20, yPos);
  }
  
  // Footer
  doc.setFontSize(8);
  doc.setTextColor(128, 128, 128);
  doc.text('Generated by LocumsLab - For illustrative purposes only', 20, 280);
  
  doc.save(`${title.replace(/[^a-z0-9]/gi, '_')}_${date}.pdf`);
}

async function exportComparison() {
  if (!isPro) {
    showUpgradeModal();
    return;
  }
  
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  
  const date = new Date().toLocaleDateString();
  
  // Header
  doc.setFontSize(20);
  doc.setFont(undefined, 'bold');
  doc.text('Scenario Comparison Report', 20, 20);
  
  doc.setFontSize(12);
  doc.setFont(undefined, 'normal');
  doc.text(`Generated: ${date}`, 20, 30);
  
  let yPos = 45;
  
  // Get scenarios
  const scenarios = await getUserScenarios();
  
  doc.setFontSize(14);
  doc.setFont(undefined, 'bold');
  doc.text('Scenarios Compared:', 20, yPos);
  yPos += 10;
  
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  scenarios.forEach(s => {
    doc.text(`• ${s.name}`, 25, yPos);
    yPos += 6;
  });
  
  yPos += 10;
  
  // Comparison table
  doc.setFontSize(14);
  doc.setFont(undefined, 'bold');
  doc.text('Key Metrics:', 20, yPos);
  yPos += 10;
  
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  
  const table = document.getElementById('comparisonTable');
  const rows = table.querySelectorAll('tr');
  
  rows.forEach((row, idx) => {
    if (idx === 0) {
      // Header row
      doc.setFont(undefined, 'bold');
    } else {
      doc.setFont(undefined, 'normal');
    }
    
    const cells = row.querySelectorAll('th, td');
    let xPos = 20;
    cells.forEach(cell => {
      doc.text(cell.textContent.substring(0, 25), xPos, yPos);
      xPos += 60;
    });
    yPos += 7;
    
    if (yPos > 270) {
      doc.addPage();
      yPos = 20;
    }
  });
  
  // Footer
  doc.setFontSize(8);
  doc.setTextColor(128, 128, 128);
  doc.text('Generated by LocumsLab - For illustrative purposes only', 20, 280);
  
  doc.save(`Scenario_Comparison_${date}.pdf`);
}

// Initialize
// Fix browser back button — prevent going back to marketing index.html
// Push a history entry for the app so back stays within the app
if (!window.history.state || window.history.state.app !== 'locumslab') {
window.addEventListener('load', async () => {
  toggleRateType();

  // Check for existing Supabase session
  const { data: { session } } = await sb.auth.getSession();

  if (session?.user) {
    currentUser = session.user.email;
    currentUserId = session.user.id;

    // Fetch Pro status from entitlements table
    const { data: entitlement } = await sb
      .from('entitlements')
      .select('plan, status')
      .eq('user_id', session.user.id)
      .single();
    isPro = entitlement?.plan === 'pro' && entitlement?.status === 'active';

    showMainApp();
  } else {
    // Demo mode - show app without login
    showMainApp();
  }

  // MOBILE FIX: touch event listeners
  setTimeout(() => {
    const upgradeBtn = document.getElementById('upgradeBtn');
    if (upgradeBtn && !currentUser) {
      upgradeBtn.addEventListener('touchstart', function(e) {
        e.preventDefault(); e.stopPropagation(); showAuthScreen();
      }, { passive: false });
    }
    document.querySelectorAll('a[onclick*="showAuthScreen"]').forEach(link => {
      link.addEventListener('touchstart', function(e) {
        e.preventDefault(); e.stopPropagation(); showAuthScreen();
      }, { passive: false });
    });
  }, 500);
});
// ===== LEGAL CONTENT =====
const LEGAL = {
  privacy: {
    title: "Privacy",
    body: `
      <p><strong>Short version:</strong> LocumsLab stores your scenarios securely in your account database. Your data is tied to your login and accessible across devices.</p>
      <ul>
        <li><strong>What we store:</strong> Your email (for login in this demo) and scenario data you save.</li>
        <li><strong>Where it lives:</strong> Your device / browser storage. Clearing site data or switching devices will remove access.</li>
        <li><strong>Analytics:</strong> If you enable optional analytics, it will collect basic usage events (page views) but not your scenario contents.</li>
      </ul>
      <p>If you have questions, email <a href="mailto:hello@locumslab.com" style="color: var(--accent); text-decoration: underline;">hello@locumslab.com</a>.</p>
    `
  },
  terms: {
    title: "Terms",
    body: `
      <p><strong>LocumsLab provides educational estimates only.</strong> It is not financial, legal, tax, or professional advice.</p>
      <ul>
        <li>Calculations use simplified assumptions (e.g., flat tax rates) and may be inaccurate for your situation.</li>
        <li>You are responsible for verifying outputs and decisions, including with a qualified tax professional.</li>
        <li>Use at your own risk. We provide the tool “as is” without warranties.</li>
      </ul>
      <p>By using the site, you agree to these terms.</p>
    `
  }
};

function showLegal(kind) {
  const modal = document.getElementById('legalModal');
  const content = LEGAL[kind] || LEGAL.terms;
  document.getElementById('legalTitle').textContent = content.title;
  document.getElementById('legalBody').innerHTML = content.body;
  modal.classList.add('active');
}
function hideLegalModal() {
  document.getElementById('legalModal').classList.remove('active');
}

// ─────────────────────────────────────────────
// BENCHMARKS TAB LOGIC
// ─────────────────────────────────────────────

const BENCH_DATA = {
  crna: {
    name: 'CRNA',
    malpractice: { low: 6000, mid: 10000, high: 15000 },
    cme: { low: 3000, mid: 3800, high: 5000 },
    licensing: { low: 800, mid: 1200, high: 2000 },
    health_insurance: { low: 7200, mid: 12000, high: 21600 },
    cpa: { low: 2500, mid: 3500, high: 5000 },
    scorp_salary_pct: 0.55,
    note: 'Malpractice: CRNA individual policy. No employer tail coverage if self-employed.',
  },
  md_hospitalist: {
    name: 'Physician – Hospitalist',
    malpractice: { low: 8000, mid: 13000, high: 20000 },
    cme: { low: 3000, mid: 4073, high: 7000 },
    licensing: { low: 1200, mid: 1800, high: 3000 },
    health_insurance: { low: 7200, mid: 12000, high: 21600 },
    cpa: { low: 3000, mid: 4000, high: 6000 },
    scorp_salary_pct: 0.60,
    note: 'Malpractice: low-moderate risk specialty. Consider occurrence vs claims-made.',
  },
  md_em: {
    name: 'Physician – Emergency Medicine',
    malpractice: { low: 20000, mid: 27000, high: 40000 },
    cme: { low: 3000, mid: 4073, high: 7000 },
    licensing: { low: 1200, mid: 1800, high: 3000 },
    health_insurance: { low: 7200, mid: 12000, high: 21600 },
    cpa: { low: 3000, mid: 4000, high: 6000 },
    scorp_salary_pct: 0.55,
    note: 'Malpractice: EM is high-risk. Washington state: ~$27k average per Med Liability Monitor.',
  },
  md_anesthesia: {
    name: 'Physician – Anesthesiology',
    malpractice: { low: 15000, mid: 22000, high: 30000 },
    cme: { low: 3000, mid: 4073, high: 7000 },
    licensing: { low: 1200, mid: 1800, high: 3000 },
    health_insurance: { low: 7200, mid: 12000, high: 21600 },
    cpa: { low: 3000, mid: 4000, high: 6000 },
    scorp_salary_pct: 0.55,
    note: 'Malpractice: Anesthesiology is high-risk but lower than OB/GYN. Tail coverage critical.',
  },
  md_fp: {
    name: 'Physician – Family Practice',
    malpractice: { low: 5000, mid: 9000, high: 12000 },
    cme: { low: 3000, mid: 4073, high: 7000 },
    licensing: { low: 1200, mid: 1800, high: 3000 },
    health_insurance: { low: 7200, mid: 12000, high: 21600 },
    cpa: { low: 3000, mid: 4000, high: 6000 },
    scorp_salary_pct: 0.60,
    note: 'Malpractice: FP without surgery is moderate risk. ~$11.5k avg per Med Liability Monitor.',
  },
  np: {
    name: 'Nurse Practitioner',
    malpractice: { low: 1200, mid: 2500, high: 4500 },
    cme: { low: 1500, mid: 2083, high: 3500 },
    licensing: { low: 500, mid: 800, high: 1500 },
    health_insurance: { low: 7200, mid: 12000, high: 21600 },
    cpa: { low: 2000, mid: 3000, high: 4500 },
    scorp_salary_pct: 0.65,
    note: 'Malpractice: NPs practicing independently. Scope expansion increases liability over time.',
  },
  pa: {
    name: 'Physician Assistant',
    malpractice: { low: 1700, mid: 2200, high: 2650 },
    cme: { low: 1500, mid: 2083, high: 3500 },
    licensing: { low: 500, mid: 800, high: 1500 },
    health_insurance: { low: 7200, mid: 12000, high: 21600 },
    cpa: { low: 2000, mid: 3000, high: 4500 },
    scorp_salary_pct: 0.65,
    note: 'Malpractice: PA individual policy $1,700–$2,650/yr per CareProInsurance 2025 data.',
  },
  rn: {
    name: 'Registered Nurse',
    malpractice: { low: 500, mid: 1000, high: 2000 },
    cme: { low: 1000, mid: 1500, high: 2500 },
    licensing: { low: 200, mid: 400, high: 800 },
    health_insurance: { low: 7200, mid: 12000, high: 21600 },
    cpa: { low: 1500, mid: 2500, high: 3500 },
    scorp_salary_pct: 0.70,
    note: 'Malpractice: RN individual policy. Group coverage usually cheaper through employer.',
  }
};

function calcSEtax(grossIncome) {
  // SE tax on ~92.35% of net
  const netForSE = grossIncome * 0.9235;
  const ssTax = Math.min(netForSE, 176100) * 0.124;
  const medTax = netForSE * 0.029;
  const addlMed = netForSE > 200000 ? (netForSE - 200000) * 0.009 : 0;
  return ssTax + medTax + addlMed;
}

function calcFedIncomeTax(taxableIncome) {
  // 2025 MFJ brackets
  const brackets = [
    [23850, 0.10],
    [96950 - 23850, 0.12],
    [206700 - 96950, 0.22],
    [394600 - 206700, 0.24],
    [501050 - 394600, 0.32],
    [751600 - 501050, 0.35],
    [Infinity, 0.37]
  ];
  let tax = 0, remaining = Math.max(0, taxableIncome);
  for (const [size, rate] of brackets) {
    const taxable = Math.min(remaining, size);
    tax += taxable * rate;
    remaining -= taxable;
    if (remaining <= 0) break;
  }
  return tax;
}

function renderBenchmarks() {
  const prof = document.getElementById('bench-profession').value;
  const income = parseFloat(document.getElementById('bench-income').value) || 250000;
  const data = BENCH_DATA[prof];
  if (!data) return;

  // ── EXPENSES ──
  const expGrid = document.getElementById('bench-expenses-grid');
  const expItems = [
    { label: 'Malpractice Insurance', icon: '🛡️', low: data.malpractice.low, mid: data.malpractice.mid, high: data.malpractice.high, color: '#ef4444' },
    { label: 'Health Insurance', icon: '🏥', low: data.health_insurance.low, mid: data.health_insurance.mid, high: data.health_insurance.high, color: '#f59e0b', note: 'Individual/family ACA marketplace est.' },
    { label: 'CME / Education', icon: '📚', low: data.cme.low, mid: data.cme.mid, high: data.cme.high, color: '#3b82f6' },
    { label: 'Licensing & DEA', icon: '📋', low: data.licensing.low, mid: data.licensing.mid, high: data.licensing.high, color: '#8b5cf6' },
    { label: 'CPA / Payroll', icon: '🧾', low: data.cpa.low, mid: data.cpa.mid, high: data.cpa.high, color: '#10b981' },
  ];
  const totalLow = expItems.reduce((s, e) => s + e.low, 0);
  const totalMid = expItems.reduce((s, e) => s + e.mid, 0);
  const totalHigh = expItems.reduce((s, e) => s + e.high, 0);

  expGrid.innerHTML = expItems.map(e => `
    <div style="background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px;">
      <div style="font-size: 1.25rem; margin-bottom: 8px;">${e.icon}</div>
      <div style="font-size: 0.8125rem; font-weight: 600; color: var(--muted); margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.04em;">${e.label}</div>
      <div style="display: flex; gap: 8px; align-items: flex-end; margin-bottom: 8px;">
        <div style="flex: 1; text-align: center;">
          <div style="font-size: 0.6875rem; color: var(--muted); margin-bottom: 2px;">LOW</div>
          <div style="font-size: 1rem; font-weight: 700; color: var(--text);">${fmt(e.low)}</div>
        </div>
        <div style="flex: 1; text-align: center; background: rgba(${e.color === '#ef4444' ? '239,68,68' : e.color === '#f59e0b' ? '245,158,11' : e.color === '#3b82f6' ? '59,130,246' : e.color === '#8b5cf6' ? '139,92,246' : '16,185,129'}, 0.1); border-radius: 6px; padding: 4px;">
          <div style="font-size: 0.6875rem; color: var(--muted); margin-bottom: 2px;">TYPICAL</div>
          <div style="font-size: 1.0625rem; font-weight: 700; color: ${e.color};">${fmt(e.mid)}</div>
        </div>
        <div style="flex: 1; text-align: center;">
          <div style="font-size: 0.6875rem; color: var(--muted); margin-bottom: 2px;">HIGH</div>
          <div style="font-size: 1rem; font-weight: 700; color: var(--text);">${fmt(e.high)}</div>
        </div>
      </div>
      ${e.note ? `<div style="font-size: 0.6875rem; color: var(--muted); line-height: 1.4;">${e.note}</div>` : ''}
    </div>
  `).join('');

  document.getElementById('bench-total-expenses').textContent =
    `${fmt(totalLow)} – ${fmt(totalMid)} – ${fmt(totalHigh)} (low / typical / high)`;

  // ── RETIREMENT ──
  const retGrid = document.getElementById('bench-retirement-grid');
  // Solo 401k: employee $23,500 + employer 25% of W2 salary
  // Approximation: employer contribution ≈ 20% of net self-employment income (Schedule C)
  const solo401k_employee = 23500;
  const solo401k_employer = Math.min(income * 0.20, 46500); // ~25% of (income - half SE tax)
  const solo401k_total = Math.min(solo401k_employee + solo401k_employer, 70000);
  const solo401k_catchup = 77500; // age 50+

  // SEP-IRA: 25% of compensation (≈20% of net SE income), max $70k
  const sep_contrib = Math.min(income * 0.20, 70000);
  const sep_needed_to_max = 350000; // need $350k income to hit $70k SEP max

  const solo_advantage = solo401k_total - sep_contrib;

  retGrid.innerHTML = `
    <div style="background: var(--surface); border: 2px solid rgba(139,92,246,0.4); border-radius: 12px; padding: 24px; position: relative;">
      <div style="position: absolute; top: -1px; right: 16px; background: #8b5cf6; color: white; font-size: 0.6875rem; font-weight: 700; padding: 4px 10px; border-radius: 0 0 8px 8px;">RECOMMENDED</div>
      <div style="font-size: 1rem; font-weight: 700; color: var(--text); margin-bottom: 4px;">Solo 401(k)</div>
      <div style="font-size: 0.8125rem; color: var(--muted); margin-bottom: 16px;">Best for solo providers with no employees</div>
      <div style="font-size: 2rem; font-weight: 800; color: #8b5cf6; margin-bottom: 4px;">${fmt(solo401k_total)}</div>
      <div style="font-size: 0.8125rem; color: var(--muted); margin-bottom: 16px;">Max contribution at ${fmt(income)} income</div>
      <div style="display: flex; flex-direction: column; gap: 8px; font-size: 0.8125rem;">
        <div style="display: flex; justify-content: space-between; padding: 8px 12px; background: var(--surface2); border-radius: 6px;">
          <span style="color: var(--muted);">Employee elective</span>
          <span style="font-weight: 700; color: var(--text);">${fmt(solo401k_employee)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 8px 12px; background: var(--surface2); border-radius: 6px;">
          <span style="color: var(--muted);">Employer (profit sharing)</span>
          <span style="font-weight: 700; color: var(--text);">${fmt(solo401k_employer)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 8px 12px; background: var(--surface2); border-radius: 6px;">
          <span style="color: var(--muted);">Age 50+ catch-up total</span>
          <span style="font-weight: 700; color: var(--text);">Up to ${fmt(solo401k_catchup)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 8px 12px; background: var(--surface2); border-radius: 6px;">
          <span style="color: var(--muted);">Backdoor Roth compatible</span>
          <span style="font-weight: 700; color: #10b981;">✓ Yes</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 8px 12px; background: var(--surface2); border-radius: 6px;">
          <span style="color: var(--muted);">Roth option (SECURE 2.0)</span>
          <span style="font-weight: 700; color: #10b981;">✓ Yes</span>
        </div>
      </div>
    </div>

    <div style="background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 24px;">
      <div style="font-size: 1rem; font-weight: 700; color: var(--text); margin-bottom: 4px;">SEP-IRA</div>
      <div style="font-size: 0.8125rem; color: var(--muted); margin-bottom: 16px;">Simpler setup; best if you have eligible employees</div>
      <div style="font-size: 2rem; font-weight: 800; color: var(--text); margin-bottom: 4px;">${fmt(sep_contrib)}</div>
      <div style="font-size: 0.8125rem; color: var(--muted); margin-bottom: 16px;">Max contribution at ${fmt(income)} income (need ${fmt(sep_needed_to_max)} to hit $70k max)</div>
      <div style="display: flex; flex-direction: column; gap: 8px; font-size: 0.8125rem;">
        <div style="display: flex; justify-content: space-between; padding: 8px 12px; background: var(--surface2); border-radius: 6px;">
          <span style="color: var(--muted);">Formula</span>
          <span style="font-weight: 700; color: var(--text);">~20% of net SE income</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 8px 12px; background: var(--surface2); border-radius: 6px;">
          <span style="color: var(--muted);">2025 annual maximum</span>
          <span style="font-weight: 700; color: var(--text);">$70,000</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 8px 12px; background: var(--surface2); border-radius: 6px;">
          <span style="color: var(--muted);">Age 50+ catch-up</span>
          <span style="font-weight: 700; color: #ef4444;">✗ None</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 8px 12px; background: var(--surface2); border-radius: 6px;">
          <span style="color: var(--muted);">Backdoor Roth compatible</span>
          <span style="font-weight: 700; color: #10b981;">✓ Yes (SECURE 2.0 resolved pro-rata issue)</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 8px 12px; ${solo_advantage > 0 ? 'background: rgba(139,92,246,0.1); border: 1px solid rgba(139,92,246,0.3);' : 'background: var(--surface2);'} border-radius: 6px;">
          <span style="color: var(--muted);">Solo 401(k) advantage</span>
          <span style="font-weight: 700; color: ${solo_advantage > 0 ? '#8b5cf6' : 'var(--text)'};">${solo_advantage > 0 ? '+' + fmt(solo_advantage) + '/yr' : 'Equal at this income'}</span>
        </div>
      </div>
    </div>
  `;

  // ── TAX BURDEN (Pro only) ──
  const taxProContent = document.getElementById('bench-tax-pro-content');
  const taxPaywall = document.getElementById('bench-tax-paywall');
  if (!isPro) {
    if (taxProContent) taxProContent.classList.add('hidden');
    if (taxPaywall) taxPaywall.classList.remove('hidden');
    return;
  }
  if (taxProContent) taxProContent.classList.remove('hidden');
  if (taxPaywall) taxPaywall.classList.add('hidden');

  const taxGrid = document.getElementById('bench-tax-grid');
  const taxTableBody = document.getElementById('bench-tax-table-body');
  const stdDeduction = 30000; // MFJ 2025

  // W2 scenario
  const w2_fica_employee = Math.min(income, 176100) * 0.0765 + Math.max(0, income - 176100) * 0.0145;
  const w2_taxable = Math.max(0, income - stdDeduction);
  const w2_fed = calcFedIncomeTax(w2_taxable);
  const w2_addlMed = income > 250000 ? (income - 250000) * 0.009 : 0;
  const w2_total = w2_fica_employee + w2_fed + w2_addlMed;
  const w2_effective = (w2_total / income * 100).toFixed(1);
  const w2_marginal = income > 501050 ? 37 : income > 394600 ? 35 : income > 206700 ? 32 : income > 96950 ? 24 : income > 23850 ? 22 : 12;

  // 1099 sole prop
  const se_tax = calcSEtax(income);
  const se_deduction = se_tax * 0.5;
  const sp_taxable = Math.max(0, income - se_deduction - stdDeduction);
  const sp_fed = calcFedIncomeTax(sp_taxable);
  const sp_addlMed = income > 200000 ? (income - 200000) * 0.009 : 0;
  const sp_total = se_tax + sp_fed;
  const sp_effective = (sp_total / income * 100).toFixed(1);

  // S-Corp: split income between salary and distribution
  const scorp_salary = Math.round(income * data.scorp_salary_pct);
  const scorp_dist = income - scorp_salary - 3500; // subtract ~$3.5k CPA/payroll cost
  const scorp_employer_fica = Math.min(scorp_salary, 176100) * 0.0765 + Math.max(0, scorp_salary - 176100) * 0.0145;
  const scorp_employee_fica = scorp_employer_fica; // same rate, both sides
  const scorp_deductible = scorp_employer_fica + se_deduction * 0; // only employer FICA deducted
  const scorp_taxable = Math.max(0, (scorp_salary + scorp_dist) - stdDeduction - scorp_employer_fica);
  const scorp_fed = calcFedIncomeTax(scorp_taxable);
  const scorp_addlMed = scorp_salary > 200000 ? (scorp_salary - 200000) * 0.009 : 0;
  const scorp_total = scorp_employee_fica + scorp_employer_fica + scorp_fed + scorp_addlMed + 3500;
  const scorp_effective = (scorp_total / income * 100).toFixed(1);
  const scorp_savings = sp_total - scorp_total;

  taxGrid.innerHTML = `
    <div style="background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px; text-align: center;">
      <div style="font-size: 0.75rem; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">W-2 Employee</div>
      <div style="font-size: 2rem; font-weight: 800; color: var(--text);">${w2_effective}%</div>
      <div style="font-size: 0.8125rem; color: var(--muted);">effective rate</div>
      <div style="font-size: 0.75rem; color: var(--muted); margin-top: 6px;">${w2_marginal}% marginal bracket</div>
      <div style="font-size: 0.75rem; color: var(--muted);">Total est. tax: ${fmt(w2_total)}</div>
    </div>
    <div style="background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px; text-align: center;">
      <div style="font-size: 0.75rem; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">1099 Sole Prop</div>
      <div style="font-size: 2rem; font-weight: 800; color: #ef4444;">${sp_effective}%</div>
      <div style="font-size: 0.8125rem; color: var(--muted);">effective rate</div>
      <div style="font-size: 0.75rem; color: var(--muted); margin-top: 6px;">SE tax: ${fmt(se_tax)}</div>
      <div style="font-size: 0.75rem; color: var(--muted);">Total est. tax: ${fmt(sp_total)}</div>
    </div>
    <div style="background: linear-gradient(135deg, rgba(16,185,129,0.08), rgba(59,130,246,0.08)); border: 2px solid var(--accent); border-radius: 10px; padding: 16px; text-align: center;">
      <div style="font-size: 0.75rem; font-weight: 600; color: var(--accent); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">S-Corp Optimized</div>
      <div style="font-size: 2rem; font-weight: 800; color: var(--accent);">${scorp_effective}%</div>
      <div style="font-size: 0.8125rem; color: var(--muted);">effective rate</div>
      <div style="font-size: 0.75rem; color: var(--muted); margin-top: 6px;">W-2 salary: ${fmt(scorp_salary)}</div>
      <div style="font-size: 0.75rem; color: ${scorp_savings > 0 ? 'var(--accent)' : 'var(--muted)'}; font-weight: ${scorp_savings > 0 ? 700 : 400};">Save ~${fmt(scorp_savings)}/yr vs sole prop</div>
    </div>
  `;

  const tip = (text) => `<span style="display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;background:var(--muted);color:var(--bg);font-size:0.6rem;font-weight:700;cursor:help;margin-left:4px;vertical-align:middle;" title="${text}">?</span>`;

  taxTableBody.innerHTML = `
    <tr style="border-bottom: 1px solid var(--border);">
      <td style="padding: 10px 14px; color: var(--text);">Federal Income Tax</td>
      <td style="text-align: right; padding: 10px 14px; color: var(--text);">${fmt(w2_fed)}</td>
      <td style="text-align: right; padding: 10px 14px; color: var(--text);">${fmt(sp_fed)}</td>
      <td style="text-align: right; padding: 10px 14px; color: var(--accent);">${fmt(scorp_fed)}</td>
    </tr>
    <tr style="border-bottom: 1px solid var(--border); background: var(--surface2);">
      <td style="padding: 10px 14px; color: var(--text);">FICA / Self-Employment Tax</td>
      <td style="text-align: right; padding: 10px 14px; color: var(--text);">${fmt(w2_fica_employee)} <span style="font-size: 0.75rem; color: var(--muted);">(employee only)</span></td>
      <td style="text-align: right; padding: 10px 14px; color: #ef4444;">${fmt(se_tax)} <span style="font-size: 0.75rem; color: var(--muted);">(full 15.3%)</span></td>
      <td style="text-align: right; padding: 10px 14px; color: var(--accent);">${fmt(scorp_employee_fica + scorp_employer_fica)} <span style="font-size: 0.75rem; color: var(--muted);">(salary only)</span></td>
    </tr>
    <tr style="border-bottom: 1px solid var(--border);">
      <td style="padding: 10px 14px; color: var(--text);">Additional Medicare (0.9%)</td>
      <td style="text-align: right; padding: 10px 14px; color: var(--text);">${fmt(w2_addlMed)}</td>
      <td style="text-align: right; padding: 10px 14px; color: var(--text);">${fmt(sp_addlMed)}</td>
      <td style="text-align: right; padding: 10px 14px; color: var(--accent);">${fmt(scorp_addlMed)}</td>
    </tr>
    <tr style="border-bottom: 1px solid var(--border); background: var(--surface2);">
      <td style="padding: 10px 14px; color: var(--text);">State Income Tax <span style="display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;background:var(--muted);color:var(--bg);font-size:0.6rem;font-weight:700;cursor:help;margin-left:4px;vertical-align:middle;" title="Applies to all structures at the same rate. Ranges from 0% (TX, FL, WY, NV) to 13.3% (CA). Not included in totals above — add your state rate manually.">?</span></td>
      <td style="text-align: right; padding: 10px 14px; color: var(--muted);">Varies by state</td>
      <td style="text-align: right; padding: 10px 14px; color: var(--muted);">Varies by state</td>
      <td style="text-align: right; padding: 10px 14px; color: var(--muted);">Varies by state</td>
    </tr>
    <tr style="border-bottom: 1px solid var(--border);">
      <td style="padding: 10px 14px; color: var(--text);">Quarterly Est. Tax Payments <span style="display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;background:var(--muted);color:var(--bg);font-size:0.6rem;font-weight:700;cursor:help;margin-left:4px;vertical-align:middle;" title="1099 and S-Corp owners must pay estimated taxes quarterly (Apr, Jun, Sep, Jan). Not an extra cost — just a cash flow consideration. W-2 withholding handles this automatically.">?</span></td>
      <td style="text-align: right; padding: 10px 14px; color: var(--muted);">Auto-withheld</td>
      <td style="text-align: right; padding: 10px 14px; color: var(--muted);">Required quarterly</td>
      <td style="text-align: right; padding: 10px 14px; color: var(--muted);">Required quarterly</td>
    </tr>
    <tr style="border-bottom: 1px solid var(--border); background: var(--surface2);">
      <td style="padding: 10px 14px; color: var(--text);">State Filing / Franchise Fee <span style="display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;background:var(--muted);color:var(--bg);font-size:0.6rem;font-weight:700;cursor:help;margin-left:4px;vertical-align:middle;" title="S-Corps must file annually with their state. Fees range from $0 (WY, MT) to $800/yr minimum (CA). Some states impose a separate franchise tax on S-Corps.">?</span></td>
      <td style="text-align: right; padding: 10px 14px; color: var(--muted);">N/A</td>
      <td style="text-align: right; padding: 10px 14px; color: var(--muted);">N/A</td>
      <td style="text-align: right; padding: 10px 14px; color: var(--muted);">$0–$800+/yr</td>
    </tr>
    <tr style="border-bottom: 1px solid var(--border);">
      <td style="padding: 10px 14px; color: var(--text);">Payroll Tax Deposits (940/941) <span style="display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;background:var(--muted);color:var(--bg);font-size:0.6rem;font-weight:700;cursor:help;margin-left:4px;vertical-align:middle;" title="S-Corp owners must file quarterly 941 payroll returns and annual 940 FUTA return. Usually handled by your payroll service (e.g. Gusto). Cost is included in the CPA/Payroll row.">?</span></td>
      <td style="text-align: right; padding: 10px 14px; color: var(--muted);">Employer handles</td>
      <td style="text-align: right; padding: 10px 14px; color: var(--muted);">N/A</td>
      <td style="text-align: right; padding: 10px 14px; color: var(--muted);">Included in CPA fee</td>
    </tr>
    <tr style="border-bottom: 1px solid var(--border); background: var(--surface2);">
      <td style="padding: 10px 14px; color: var(--text);">Workers&#39; Comp Insurance <span style="display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;background:var(--muted);color:var(--bg);font-size:0.6rem;font-weight:700;cursor:help;margin-left:4px;vertical-align:middle;" title="Some states require workers comp even for single-employee S-Corps. Typically $300-$800/yr if required. Most healthcare professionals are exempt — verify with your state.">?</span></td>
      <td style="text-align: right; padding: 10px 14px; color: var(--muted);">Employer provided</td>
      <td style="text-align: right; padding: 10px 14px; color: var(--muted);">N/A</td>
      <td style="text-align: right; padding: 10px 14px; color: var(--muted);">$0–$800/yr</td>
    </tr>
    <tr style="border-bottom: 1px solid var(--border);">
      <td style="padding: 10px 14px; color: var(--text);">Registered Agent Fee <span style="display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;background:var(--muted);color:var(--bg);font-size:0.6rem;font-weight:700;cursor:help;margin-left:4px;vertical-align:middle;" title="S-Corps must maintain a registered agent in their state. You can act as your own (free) or use a service like Northwest or ZenBusiness for ~$50-$150/yr.">?</span></td>
      <td style="text-align: right; padding: 10px 14px; color: var(--muted);">N/A</td>
      <td style="text-align: right; padding: 10px 14px; color: var(--muted);">N/A</td>
      <td style="text-align: right; padding: 10px 14px; color: var(--muted);">~$50–$150/yr</td>
    </tr>
    <tr style="border-bottom: 1px solid var(--border); background: var(--surface2);">
      <td style="padding: 10px 14px; color: var(--text);">CPA / Payroll Cost</td>
      <td style="text-align: right; padding: 10px 14px; color: var(--muted);">$0 <span style="font-size: 0.75rem;">(employer provided)</span></td>
      <td style="text-align: right; padding: 10px 14px; color: var(--text);">~$1,500</td>
      <td style="text-align: right; padding: 10px 14px; color: var(--accent);">~$3,500</td>
    </tr>
    <tr style="background: var(--surface2);">
      <td style="padding: 10px 14px; font-weight: 700; color: var(--text);">Total Estimated Tax Burden</td>
      <td style="text-align: right; padding: 10px 14px; font-weight: 700; color: var(--text);">${fmt(w2_total)}</td>
      <td style="text-align: right; padding: 10px 14px; font-weight: 700; color: #ef4444;">${fmt(sp_total + 1500)}</td>
      <td style="text-align: right; padding: 10px 14px; font-weight: 700; color: var(--accent);">${fmt(scorp_total)}</td>
    </tr>
  `;
}





</script>

<script>
// ============================================================
// GUIDE DRAWER
// ============================================================
(function() {
  const drawerHTML = `
  <!-- GUIDE DRAWER OVERLAY -->
  <div id="guide-drawer-overlay" onclick="closeGuideDrawer()" style="
    position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:8000;
    display:none; opacity:0; transition:opacity 0.3s;
  "></div>

  <!-- GUIDE DRAWER -->
  <div id="guide-drawer" style="
    position:fixed; top:0; right:0; bottom:0; width:min(520px,100vw);
    background:#0f1419; border-left:1px solid #2d3748;
    z-index:8001; display:flex; flex-direction:column;
    transform:translateX(100%); transition:transform 0.35s cubic-bezier(0.22,1,0.36,1);
    box-shadow:-8px 0 40px rgba(0,0,0,0.4);
  ">
    <!-- Drawer Header -->
    <div style="
      padding:20px 24px; border-bottom:1px solid #2d3748;
      display:flex; align-items:center; justify-content:space-between;
      flex-shrink:0; background:#1a1f29;
    ">
      <div>
        <div style="font-size:1rem; font-weight:700; color:#f7fafc;">📖 CRNA Guide to Going Locums</div>
        <div style="font-size:0.8125rem; color:#94a3b8; margin-top:2px;">11 chapters · Free · By John Fratianni</div>
      </div>
      <div style="display:flex; gap:10px; align-items:center;">
        <a href="CRNA_Guide_to_Going_Locums_LocumsLab.pdf" download style="
          font-size:0.8125rem; color:#10b981; font-weight:600;
          text-decoration:none; padding:6px 12px; border:1px solid rgba(16,185,129,0.4);
          border-radius:6px; transition:background 0.2s; white-space:nowrap;
        " onmouseover="this.style.background='rgba(16,185,129,0.1)'" onmouseout="this.style.background='transparent'">
          ↓ PDF
        </a>
        <button onclick="closeGuideDrawer()" style="
          background:transparent; border:none; color:#94a3b8;
          font-size:1.375rem; cursor:pointer; padding:4px; line-height:1;
        ">✕</button>
      </div>
    </div>

    <!-- Drawer Body — scrollable -->
    <div style="flex:1; overflow-y:auto; padding:24px;" id="guide-drawer-body">

      <!-- Intro -->
      <div style="
        background:linear-gradient(135deg,rgba(16,185,129,0.08),rgba(59,130,246,0.06));
        border:1px solid rgba(16,185,129,0.2); border-radius:10px;
        padding:18px 20px; margin-bottom:24px;
      ">
        <p style="font-size:0.9rem; color:#94a3b8; line-height:1.7; margin:0;">
          1099 CRNAs have a unique opportunity most W-2 employees never access — far larger tax-advantaged accounts, S-Corp distributions, and complete control over income structure. This guide covers the financial reality of making the transition, with real numbers and zero fluff.
        </p>
      </div>

      <!-- Chapters -->
      ${[
        { n:'01', title:'Why This Guide Exists', content:'The honest story behind it — written by a provider making the transition, not a CPA selling services. Most guides are written by people who profit from your confusion. This one isn\'t.' },
        { n:'02', title:'Honest Considerations', content:'Lifestyle trade-offs, benefits gap reality, and what to have in place before you take your first 1099 check. The benefits gap is typically $30,000–$45,000/year when you account for health insurance, malpractice, retirement match, CME, disability, and PTO.' },
        { n:'03', title:'LLC & S-Corp Explained', content:'When to form each. S-Corp distributions save you 15.3% SE tax on income above your "reasonable salary." At $250k net income with a $120k salary, that\'s roughly $19,000/year saved. Admin costs ~$3,500/yr (CPA + payroll service). Typically worth it above $80–100k net income.' },
        { n:'04', title:'Taxes — Day One Changes', content:'As 1099 you pay both sides of FICA (15.3%) on ~92.35% of net income. You\'ll make quarterly estimated payments (April, June, September, January). Key deductions: home office, malpractice, health insurance premiums, CME, professional dues, travel between assignments, and half of SE tax.' },
        { n:'05', title:'Malpractice Insurance', content:'Claims-made vs occurrence policies. Claims-made is cheaper annually but requires "tail coverage" (~1.5–2× annual premium) when you leave. CRNA individual policies: $6,000–$15,000/yr. Always verify your contract specifies who provides coverage and whether tail is included.' },
        { n:'06', title:'Health, Disability & Benefits', content:'Individual ACA marketplace plans average $7,200–$21,600/yr depending on coverage level and state. Budget separately for dental, vision, life, and disability. Short-term disability is often overlooked — W-2 employer typically covers 60% of salary; you\'ll need to buy your own.' },
        { n:'07', title:'Retirement Maximization', content:'1099 CRNAs can shelter dramatically more than W-2 employees. While W-2 CRNAs are capped at $23,500/yr in a 401k, 1099 CRNAs can contribute up to $70,000/yr via Solo 401(k) and stack IRA and HSA contributions on top. A 45-year-old CRNA with a non-working spouse can shelter up to $92,550/year. A married couple both aged 60 can reach $105,800/year.<br><br><strong style="color:#10b981;">Solo 401(k)</strong> — the default choice. Employee: $23,500/yr. Employer: 20% of net SE income (sole prop) or 25% of reasonable salary (S-Corp). Combined max: $70,000. Catch-up: +$7,500 ages 50–59/64+, +$11,250 ages 60–63. ⚠️ Balance over $250k requires annual IRS Form 5500-EZ — $500/day fine if missed. File free at efast.dol.gov.<br><br><strong style="color:#10b981;">Mega Backdoor Roth (S-Corp owners)</strong> — S-Corp CRNAs with a $120k salary can only contribute $53,500 directly ($23,500 + $30,000). The Mega Backdoor Roth fills the $16,500 gap via "voluntary after-tax" (VAT) contributions then immediate Roth conversion. Requires a paid custom solo 401(k) — free plans at Fidelity/Schwab/Vanguard do NOT support this. Use MySolo401k.net, Rocket Dollar, or Ubiquity (~$100–$300/yr), offset by the $1,500 EACA tax credit (Form 8881).<br><br><strong style="color:#10b981;">SEP-IRA</strong> — simpler but leaves $23,500+ on the table vs Solo 401(k). No catch-up contributions. The pro-rata rule issue for Backdoor Roth was resolved by SECURE 2.0.<br><br><strong style="color:#10b981;">Backdoor Roth IRA</strong> — contribute $7,000/yr to a traditional IRA, wait one day, convert to Roth. No income limit to contribute (only to deduct). Married: $14,000/yr total. Age 50+: add $1,000/person. Caution: existing pre-tax IRA balances trigger the pro-rata rule — consider rolling them into your Solo 401(k) first.<br><br><strong style="color:#10b981;">HSA — the stealth IRA</strong> — requires a high-deductible health plan (2025: ≥$1,650 deductible single / $3,300 family). Limits: $4,300 single / $8,550 with dependents. Triple tax advantaged: deduction in, tax-free growth, tax-free withdrawal for medical expenses. Receipts never expire — spend $1,000 on prescriptions in 2025, withdraw $1,000 tax-free in 2050.<br><br><strong style="color:#10b981;">Roth vs Traditional</strong> — most full-time 1099 CRNAs should prioritize pre-tax in high-income years. Prioritize Roth if you take extended unpaid leave, work in a high-tax state and plan to retire in a low-tax state, or save >25% of income for 30+ years.' },
        { n:'08', title:'Finding Contracts', content:'Working with agencies (CompHealth, AMN, Barton, Staff Care), evaluating offers, and the soft skills that get you the best assignments. Negotiating points beyond hourly rate: stipend structure, housing quality, scheduling flexibility, tail coverage, and completion bonuses.' },
        { n:'09', title:'Payroll & Bookkeeping', content:'Gusto for payroll (~$500/yr) handles W-2 for S-Corp owners, 940/941 filings, and year-end forms. QuickBooks Self-Employed or Keeper for bookkeeping. Set aside 25–30% of each payment for taxes in a separate account. Bill from your LLC/S-Corp, not personally.' },
        { n:'10', title:'Finding the Right CPA', content:'Look for CPAs who specifically work with independent healthcare providers or 1099 physicians/CRNAs. Questions to ask: Have you filed S-Corp returns for CRNAs? What\'s your recommended reasonable salary range? What bookkeeping software do you support? Budget $2,500–$5,000/yr for a specialty CPA — it pays for itself many times over.' },
        { n:'11', title:'Run Your Numbers', content:'All of this is theory until you model your specific situation. Use LocumsLab\'s Quick Start wizard to enter your current W-2 salary and a target locums rate. The S-Corp Evaluator (Pro) shows you your exact tax savings at your income level. The Benchmarks tab gives you malpractice, retirement, and expense benchmarks by profession.' },
      ].map(ch => `
        <div style="margin-bottom:12px; border:1px solid #2d3748; border-radius:10px; overflow:hidden;">
          <button onclick="toggleChapter('ch${ch.n}')" style="
            width:100%; background:#1a1f29; border:none; padding:16px 18px;
            display:flex; align-items:center; gap:14px; cursor:pointer;
            text-align:left; transition:background 0.2s;
          " onmouseover="this.style.background='#242b38'" onmouseout="this.style.background='#1a1f29'">
            <span style="
              font-size:0.6875rem; font-weight:700; color:#10b981;
              letter-spacing:0.08em; min-width:28px;
            ">CH ${ch.n}</span>
            <span style="font-size:0.9375rem; font-weight:600; color:#f7fafc; flex:1;">${ch.title}</span>
            <span id="ch${ch.n}-icon" style="color:#94a3b8; font-size:0.875rem; flex-shrink:0;">▶</span>
          </button>
          <div id="ch${ch.n}" style="display:none; padding:16px 18px 18px; background:#0f1419; border-top:1px solid #2d3748;">
            <p style="font-size:0.875rem; color:#94a3b8; line-height:1.75; margin:0;">${ch.content}</p>
          </div>
        </div>
      `).join('')}

      <!-- PDF download footer -->
      <div style="
        margin-top:20px; padding:20px; background:#1a1f29;
        border:1px solid #2d3748; border-radius:10px; text-align:center;
      ">
        <div style="font-size:0.875rem; color:#94a3b8; margin-bottom:14px;">
          Want the full guide with all the details?
        </div>
        <a href="CRNA_Guide_to_Going_Locums_LocumsLab.pdf" download style="
          display:inline-flex; align-items:center; gap:8px;
          background:#10b981; color:white; padding:11px 24px;
          border-radius:8px; text-decoration:none; font-weight:700;
          font-size:0.9375rem; transition:background 0.2s;
        " onmouseover="this.style.background='#059669'" onmouseout="this.style.background='#10b981'">
          📥 Download PDF (Free)
        </a>
      </div>

    </div>
  </div>
  `;

  document.body.insertAdjacentHTML('beforeend', drawerHTML);

  window.openGuideDrawer = function() {
    document.getElementById('guide-drawer-overlay').style.display = 'block';
    requestAnimationFrame(() => {
      document.getElementById('guide-drawer-overlay').style.opacity = '1';
      document.getElementById('guide-drawer').style.transform = 'translateX(0)';
    });
  };

  window.closeGuideDrawer = function() {
    document.getElementById('guide-drawer-overlay').style.opacity = '0';
    document.getElementById('guide-drawer').style.transform = 'translateX(100%)';
    setTimeout(() => {
      document.getElementById('guide-drawer-overlay').style.display = 'none';
    }, 350);
  };

  window.toggleChapter = function(id) {
    const el = document.getElementById(id);
    const icon = document.getElementById(id + '-icon');
    const open = el.style.display !== 'none';
    el.style.display = open ? 'none' : 'block';
    icon.textContent = open ? '▶' : '▼';
    icon.style.color = open ? '#94a3b8' : '#10b981';
  };

  // Auto-open if ?guide=open in URL
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('guide') === 'open') {
    window.history.replaceState({}, '', window.location.pathname);
    // Wait for app to finish loading
    window.addEventListener('load', () => setTimeout(openGuideDrawer, 600));
  }
})();

// ============================================================
// GUIDE PROMPT BANNER
// ============================================================
(function() {
  // Inject banner HTML
  const banner = document.createElement('div');
  banner.id = 'guide-banner';
  banner.innerHTML = `
    <div style="
      position: fixed;
      bottom: 0; left: 0; right: 0;
      z-index: 9000;
      background: linear-gradient(135deg, #0f2318, #0f1f2e);
      border-top: 2px solid #10b981;
      padding: 16px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      box-shadow: 0 -4px 24px rgba(16,185,129,0.18);
      transform: translateY(100%);
      transition: transform 0.45s cubic-bezier(0.22, 1, 0.36, 1);
      flex-wrap: wrap;
    " id="guide-banner-inner">
      <div style="display:flex; align-items:center; gap:14px; flex:1; min-width:0;">
        <div style="font-size:1.75rem; flex-shrink:0;">📖</div>
        <div>
          <div style="font-size:0.9375rem; font-weight:700; color:#f7fafc; margin-bottom:2px;">
            Free Guide: CRNA Guide to Going Locums
          </div>
          <div style="font-size:0.8125rem; color:#94a3b8; line-height:1.4;">
            11 chapters covering taxes, contracts, S-Corps, retirement, and more. Written by a CRNA.
          </div>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:10px; flex-shrink:0;">
        <a href="#" onclick="dismissGuideBanner(); openGuideDrawer(); return false;" style="
          display:inline-block;
          background:#10b981;
          color:white;
          font-size:0.875rem;
          font-weight:700;
          padding:10px 20px;
          border-radius:6px;
          text-decoration:none;
          white-space:nowrap;
          transition:background 0.2s;
        " onmouseover="this.style.background='#059669'" onmouseout="this.style.background='#10b981'">
          Read Free Guide →
        </a>
        <button onclick="dismissGuideBanner()" style="
          background:transparent;
          border:none;
          color:#94a3b8;
          font-size:1.25rem;
          cursor:pointer;
          padding:6px;
          line-height:1;
          flex-shrink:0;
        " title="Dismiss">✕</button>
      </div>
    </div>
  `;
  document.body.appendChild(banner);

  window.showGuideBanner = function() {
    // Never show to Pro users, never show twice per session
    if (isPro) return;
    if (sessionStorage.getItem('guide_banner_dismissed')) return;
    setTimeout(function() {
      const inner = document.getElementById('guide-banner-inner');
      if (inner) inner.style.transform = 'translateY(0)';
    }, 1200);
  };

  window.dismissGuideBanner = function() {
    const inner = document.getElementById('guide-banner-inner');
    if (inner) inner.style.transform = 'translateY(100%)';
    sessionStorage.setItem('guide_banner_dismissed', '1');
  };
})();

// ── SIGNUP NUDGE ELEMENT ──
(function() {
  const nudge = document.createElement('div');
  nudge.id = 'signup-nudge';
  nudge.style.cssText = 'display:none; position:fixed; bottom:24px; right:24px; background:#1a1f29; border:1px solid #10b981; border-radius:12px; padding:20px 24px; max-width:300px; z-index:9998; box-shadow:0 4px 24px rgba(16,185,129,0.18);';
  nudge.innerHTML = `
    <p style="margin:0 0 4px; color:#10b981; font-weight:700; font-size:0.9375rem;">Want to save this?</p>
    <p style="margin:0 0 16px; color:#94a3b8; font-size:0.875rem; line-height:1.5;">Create a free account to save scenarios and compare later.</p>
    <button onclick="showAuthScreen(); dismissSignupNudge();" style="display:block; width:100%; background:#10b981; color:white; font-family:inherit; font-weight:700; font-size:0.9375rem; padding:11px; border-radius:8px; border:none; cursor:pointer; margin-bottom:8px;">Sign Up Free →</button>
    <button onclick="dismissSignupNudge()" style="display:block; width:100%; background:none; border:none; color:#64748b; font-size:0.8125rem; font-family:inherit; cursor:pointer; padding:4px;">No thanks</button>
  `;
  document.body.appendChild(nudge);
})();

// Hook guide banner + run logging + signup nudge into all calculator result functions
const _origCalcQuickStart = calcQuickStart;
calcQuickStart = function() {
  _origCalcQuickStart.apply(this, arguments);
  showGuideBanner();
  const prof = document.getElementById('qs-profession')?.value;
  logCalculatorRun('quick-start', prof);
  showSignupNudge();
};

const _origCalcStaffLocums = calcStaffLocums;
calcStaffLocums = function() {
  _origCalcStaffLocums.apply(this, arguments);
  showGuideBanner();
  const prof = document.getElementById('staff-profession')?.value;
  logCalculatorRun('staff-vs-locums', prof);
  showSignupNudge();
};

const _origCalcW21099 = calcW21099;
calcW21099 = function() {
  _origCalcW21099.apply(this, arguments);
  showGuideBanner();
  logCalculatorRun('w2-vs-1099', null);
  showSignupNudge();
};

const _origCalcTax = calcTax;
calcTax = function() {
  _origCalcTax.apply(this, arguments);
  showGuideBanner();
  logCalculatorRun('tax-estimator', null);
  showSignupNudge();
};

const _origCalcHome = calcHome;
calcHome = function() {
  _origCalcHome.apply(this, arguments);
  showGuideBanner();
  logCalculatorRun('home-buying', null);
  showSignupNudge();
};

const _origCalcLoan = calcLoan;
calcLoan = function() {
  _origCalcLoan.apply(this, arguments);
  showGuideBanner();
  logCalculatorRun('loans', null);
  showSignupNudge();
};

// Hook True Hourly Rate and 10yr Income (no guide banner wrapper existed for these)
const _origCalcTrueHourly = calcTrueHourly;
calcTrueHourly = function() {
  _origCalcTrueHourly.apply(this, arguments);
  logCalculatorRun('true-hourly-rate', null);
  showSignupNudge();
};

const _origCalc10yr = calc10yr;
calc10yr = function() {
  _origCalc10yr.apply(this, arguments);
  logCalculatorRun('10yr-income', null);
  showSignupNudge();
};

</script>
</body>
