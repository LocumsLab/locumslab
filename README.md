# LocumsLab

**Financial calculator for physicians, CRNAs, NPs, PAs, and nurses comparing staff positions vs locums/travel contracts.**

Model income, taxes, S-Corp implications, and take-home pay before you decide.

---

## 🚀 What's New

### Fresh Landing Page
- Clean, medical-professional aesthetic (blue/white theme)
- Includes physicians in all copy
- Removed guides/blogs (just product + pricing)
- 4 pre-filled templates: MD, CRNA, NP, PA

### S-Corp Evaluator (NEW)
- Compare Sole Prop/LLC vs S-Corporation
- Shows tax savings, optimal W2/distribution split
- Retirement contribution comparison
- Recommendation based on income level

---

## 📁 Files

### Ready to Deploy:
1. **`index.html`** - New landing page (fresh design)
2. **`app.html`** - Main calculator app (needs S-Corp integration)
3. **`scorp-calculator-component.html`** - S-Corp calculator to integrate

### How to Deploy:

**Option 1: Just Landing Page (Quick)**
1. Replace current `index.html` with new version
2. Push to GitHub
3. Netlify auto-deploys

**Option 2: Full Update (Recommended)**
1. Replace `index.html`
2. Integrate S-Corp calculator into `app.html` (see instructions below)
3. Push to GitHub

---

## 🛠️ How to Add S-Corp Calculator

The S-Corp calculator is in `scorp-calculator-component.html`. Here's how to add it to your app:

### Step 1: Add to Wizard Choices

Find this section in `app.html` (around line 1080):
```html
<div class="choice-card" onclick="selectGoal('explore')">
```

Add a 5th choice before it:
```html
<div class="choice-card" onclick="selectGoal('scorp')">
  <div class="choice-icon">💼</div>
  <h3>S-Corp Evaluator</h3>
  <p>Should you form an S-Corporation?</p>
</div>
```

### Step 2: Add Calculator Section

Find the calculators section (after line 1200). Copy the entire contents of `scorp-calculator-component.html` and paste it as a new calculator section.

### Step 3: Update selectGoal Function

Find `function selectGoal(goal)` (around line 1914). Add this case:
```javascript
case 'scorp':
  document.getElementById('scorp-calculator').classList.remove('hidden');
  break;
```

### Step 4: Test

- Click "S-Corp Evaluator" in wizard
- Enter income and expenses
- See comparison

---

## ✨ Features

### 7 Calculators:
1. **Staff vs Locums** - Compare positions
2. **W2 vs 1099** - Tax implications
3. **S-Corp Evaluator** - Entity structure analysis (NEW!)
4. **Tax Estimator** - Estimate taxes
5. **Home Buying** - Affordability timeline
6. **Student Loans** - Payoff strategy
7. **10-Year Income** - Long-term projections

### Pro Features ($39 one-time):
- Unlimited saved scenarios
- S-Corp Evaluator (unlocked)
- Side-by-side comparison
- PDF export
- Lifetime access

---

## 🎯 Target Audience

- **Physicians** (Hospitalists, EM, Anesthesia, etc.)
- **CRNAs** (Certified Registered Nurse Anesthetists)
- **NPs** (Nurse Practitioners)
- **PAs** (Physician Assistants)
- **Nurses** (Travel/Staff RNs)

**Total Market:** ~300,000 healthcare professionals

---

## 💰 Pricing

### Free:
- All 7 calculators
- Save 3 scenarios
- Basic comparisons

### Pro ($39 one-time):
- Unlimited scenarios
- S-Corp Evaluator
- Side-by-side comparison
- PDF export
- Lifetime access

---

## 📊 Revenue Projections

**Conservative (Year 1):**
- 1,000 users
- 8% conversion = 80 users × $39
- Revenue: **$3,120**

**Realistic (Year 1):**
- 2,000 users  
- 10% conversion = 200 users × $39
- Revenue: **$7,800**

**Optimistic (Year 1):**
- 5,000 users
- 12% conversion = 600 users × $39
- Revenue: **$23,400**

---

## 🚀 Launch Strategy

### Week 1: Deploy
1. Replace landing page
2. Integrate S-Corp calculator (optional - can launch without it)
3. Test everything
4. Buy LocumsLab.com domain

### Week 2: Beta Test
Post in:
- r/medicine
- r/Residency
- r/CRNA
- r/NursePractitioner
- r/physicianassistant

**Post:**
> "I built a free calculator for comparing staff vs locums contracts. Includes S-Corp evaluator and tax analysis. Would love feedback from physicians/CRNAs/NPs/PAs: [link]"

### Week 3: Iterate
- Fix bugs
- Add requested features
- Improve based on feedback

### Month 2: Scale
- Add Stripe for Pro tier
- SEO optimization
- Get first paying customers

---

## 🔒 Legal & Compliance

### Disclaimers:
- "For illustrative purposes only"
- "Consult a tax professional for personalized advice"
- Included in footer

### No Fake Testimonials:
- Trust builders only (privacy, accuracy, ease of use)
- Real testimonials after beta testing (with permission)

---

## 📧 Support

hello@locumslab.com

---

## 📜 License

Proprietary - All rights reserved

---

**Built for healthcare professionals making career decisions.**
