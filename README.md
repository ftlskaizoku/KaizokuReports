# Kaizoku Reports — Netlify Deploy

## Stack
- **Frontend:** Static files → Netlify CDN
- **Backend:** Netlify Serverless Functions (Express wrapped with serverless-http)
- **Database:** Neon.tech (free PostgreSQL)
- **Nightly jobs:** cron-job.org (free, calls `/api/cron/nightly`)

---

## Step 1 — Database (Neon.tech) — 2 minutes

1. Go to **neon.tech** → sign up free
2. Create a new project → name it `kaizoku`
3. Copy the **Connection string** — looks like:
   `postgresql://kaizoku:xxxx@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require`

That's your `DATABASE_URL`. No linking, no plugins — just paste it.

---

## Step 2 — GitHub Repo

```bash
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/YOUR_USERNAME/kaizoku-reports.git
git push -u origin main
```

---

## Step 3 — Netlify Deploy

1. Go to **netlify.com** → Add new site → Import from GitHub
2. Select `kaizoku-reports` repo
3. Build settings are auto-detected from `netlify.toml` — no changes needed
4. Click **Deploy site**

---

## Step 4 — Environment Variables

In Netlify → Site → **Site configuration** → **Environment variables** → Add:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Your Neon connection string |
| `JWT_SECRET` | Any long random string |
| `CRON_SECRET` | Any secret (used to protect the nightly job endpoint) |
| `VAPID_PUBLIC_KEY` | From: `node -e "const wp=require('web-push'); const k=wp.generateVAPIDKeys(); console.log(JSON.stringify(k))"` |
| `VAPID_PRIVATE_KEY` | Same command above |
| `VAPID_EMAIL` | `mailto:your@email.com` |

After adding variables → **Trigger deploy** to restart.

---

## Step 5 — First Run Setup

Open your Netlify URL → you'll see the Setup screen automatically.
Fill in your admin account (with your email `khalifadylla@gmail.com`) and up to 3 more users.
Hit **Create Accounts** — done. The EA API key is shown on screen.

---

## Step 6 — EA Setup

In MetaTrader 5:
1. `Tools → Options → Expert Advisors` → Allow WebRequest → add your Netlify URL
2. Copy `Kaizoku_DataFeeder.mq5` to `MQL5/Experts/` and compile
3. Set `InpServerURL` = `https://your-site.netlify.app`
4. Set `InpApiKey` = the key shown after setup (also in Admin Panel)
5. Attach to any chart

---

## Step 7 — Nightly Reports (cron-job.org)

1. Go to **cron-job.org** → sign up free
2. Create a new cron job:
   - URL: `https://your-site.netlify.app/api/cron/nightly`
   - Method: `POST`
   - Headers: `x-cron-secret: YOUR_CRON_SECRET`
   - Schedule: `30 22 * * 1-5` (22:30 UTC Mon–Fri)
3. Save — reports will generate automatically after market close

You can also manually trigger from **Admin Panel → Run Jobs Now** anytime.

---

## Variables Summary

Only required: `DATABASE_URL`, `JWT_SECRET`, `CRON_SECRET`
Optional (for push notifications): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL`
