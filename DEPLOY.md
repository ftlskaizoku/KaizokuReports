# HOW TO DEPLOY — Run these commands exactly

## Step 1 — Go into the kaizoku-clean folder
cd kaizoku-clean

## Step 2 — Initialize git and force push to replace EVERYTHING in your repo
git init
git add .
git status   # You should see ONLY these files:
             # api/[...path].js
             # lib/db.js lib/classifier.js lib/reporter.js lib/push.js lib/settings.js
             # public/index.html public/css/app.css public/js/app.js public/js/charts.js
             # public/manifest.json public/sw.js
             # package.json vercel.json .gitignore Kaizoku_DataFeeder.mq5

git commit -m "clean vercel build - fixes all routing"

git remote add origin https://github.com/ftlskaizoku/KaizokuReports.git
git push origin main --force

## Step 3 — Vercel will auto-redeploy. Check Vercel dashboard to confirm.

## Step 4 — Make sure these 3 env vars are set in Vercel:
## DATABASE_URL   = your Neon.tech connection string
## JWT_SECRET     = Kaizoku2026_jwt_secret_xau
## CRON_SECRET    = Kaizoku2026_cron

## Step 5 — Open the site and Create Account
