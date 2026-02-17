# LocumsLab

**Financial clarity for healthcare professionals comparing staff positions vs locums contracts.**

Compare contracts, model scenarios, and make confident career decisions.

---

## 🚀 Quick Deploy to Netlify

### Option 1: Drag & Drop (Fastest)

1. Go to [netlify.com](https://netlify.com) and sign up (free)
2. Click **"Add new site"** → **"Deploy manually"**
3. Drag **both files** (`index.html` and `app.html`) into the drop zone
4. Done! You'll get a URL like `https://your-site.netlify.app`

### Option 2: Deploy from GitHub (Recommended)

1. **Push this repo to GitHub:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/locumslab.git
   git push -u origin main
   ```

2. **Connect to Netlify:**
   - Go to [netlify.com](https://netlify.com)
   - Click **"Add new site"** → **"Import from Git"**
   - Select your GitHub repo
   - Build settings:
     - Build command: (leave blank)
     - Publish directory: `/`
   - Click **"Deploy site"**

3. **Auto-deploys enabled!** Every push to `main` branch automatically deploys.

---

## 🌐 Add Custom Domain

### Step 1: Buy Domain
- Recommended: [Namecheap](https://namecheap.com) or [Cloudflare](https://cloudflare.com)
- Cost: ~$10-12/year for `.com`

### Step 2: Configure DNS in Netlify
1. Go to **Site Settings** → **Domain Management**
2. Click **"Add custom domain"**
3. Enter your domain (e.g., `locumslab.com`)
4. Netlify will show DNS records to add

### Step 3: Update DNS at Registrar
In your domain registrar (Namecheap, Cloudflare, etc.):
- **A Record:** `@` → `75.2.60.5`
- **CNAME:** `www` → `your-site.netlify.app`

### Step 4: Wait for DNS Propagation
- Usually takes 10-30 minutes
- HTTPS automatically enabled by Netlify (free Let's Encrypt certificate)

---

## 📁 File Structure

```
locumslab/
├── index.html          # Landing page (marketing site)
├── app.html            # Calculator app (all 6 calculators)
└── README.md           # This file
```

---

## ✨ Features

### Landing Page (`index.html`)
- Hero section with clear value proposition
- Pain points addressed
- Feature highlights
- Pre-filled templates (CRNA, NP, PA)
- Pricing (Free vs Pro)
- FAQ section
- No fake testimonials (compliant with FTC regulations)

### App (`app.html`)
**6 Calculators:**
1. 📊 Staff vs Locums Comparison
2. 💼 W2 vs 1099 Tax Comparison
3. 🧾 Self-Employment Tax Estimator
4. 🏠 Home Affordability Timeline
5. 🎓 Student Loan Payoff Strategy
6. 📈 10-Year Income Projection

**Features:**
- ✅ No signup required to use calculators
- ✅ Demo mode (try all features free)
- ✅ Save scenarios (gated behind signup)
- ✅ Comparison view (Pro feature)
- ✅ PDF export (Pro feature)
- ✅ All data stored in browser (localStorage)

---

## 💰 Pricing Model

### Free Plan
- 3 saved scenarios
- All 6 calculators
- Pre-filled templates

### Pro Plan ($9/month)
- Unlimited saved scenarios
- Scenario comparison view
- PDF export for reports
- Priority support

---

## 🔒 Privacy & Data

- All calculations run **client-side** (in browser)
- User data stored in **localStorage** (not on servers)
- No personal financial data transmitted or stored on backend
- GDPR/privacy friendly

---

## 🛠️ Tech Stack

- **Frontend:** Pure HTML, CSS, JavaScript
- **Charts:** Chart.js
- **PDF Generation:** jsPDF
- **Payments:** Stripe (placeholder - replace API keys)
- **Hosting:** Netlify (recommended) or Vercel
- **Database:** localStorage (browser-based)

---

## 🔑 Setup Stripe (Optional)

To enable real payments:

1. Create [Stripe account](https://stripe.com)
2. Get your **Publishable Key** from Dashboard
3. Replace in `app.html`:
   ```javascript
   const stripe = Stripe('pk_test_REPLACE_WITH_YOUR_KEY');
   ```
4. Set up $9/month subscription product in Stripe Dashboard
5. Update checkout flow to create real Stripe Checkout Sessions

---

## 📝 Legal Compliance

### Testimonials
- ❌ No fake testimonials (FTC violation)
- ✅ Current version uses trust builders instead
- ✅ After beta testing, add real testimonials with written permission

### Disclaimers
- "For illustrative purposes only"
- "Consult with a tax professional"
- Included in footer of both pages

---

## 🐛 Known Limitations

- **localStorage only** - Data doesn't sync across devices (by design)
- **No backend** - All authentication is demo/localStorage based
- **Stripe placeholder** - Needs real API integration for payments
- **Tax calculations simplified** - Uses flat rates, not actual IRS brackets

---

## 🚧 Roadmap

### Phase 1: Launch (Week 1-2)
- [x] Landing page
- [x] Full calculator app
- [ ] Deploy to Netlify
- [ ] Beta test with 10 users

### Phase 2: Real Backend (Month 1-2)
- [ ] Add real user authentication (Firebase/Supabase)
- [ ] Add real database (store scenarios server-side)
- [ ] Integrate Stripe for real payments

### Phase 3: Growth (Month 3-6)
- [ ] SEO content ("CRNA locums calculator", etc.)
- [ ] Real testimonials from beta users
- [ ] Email reminders ("Update your scenarios monthly")
- [ ] Mobile app (React Native)

---

## 📧 Contact

For questions or feedback: hello@locumslab.com

---

## 📜 License

Proprietary - All rights reserved

---

**Built for healthcare professionals making career decisions.**
