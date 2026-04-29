# Kaizoku Reports

Kaizoku Reports — private daily market intelligence for UK100, DE30, XAUUSD and USOIL.  
Built as a PWA — installable on mobile and desktop.

---

## Stack

- **Backend:** Node.js + Express
- **Database:** PostgreSQL (Railway built-in)
- **Frontend:** Vanilla JS PWA with TradingView Lightweight Charts
- **Notifications:** Web Push (self-hosted VAPID)
- **Hosting:** Railway

---

## Setup

### 1. Clone and push to GitHub

```bash
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/YOUR_USERNAME/kaizoku-reports.git
git push -u origin main
```

### 2. Deploy on Railway

1. Go to [railway.com/dashboard](https://railway.com/dashboard)
2. New Project → Deploy from GitHub repo → select `kaizoku-reports`
3. Add a **PostgreSQL** plugin to the project
4. Railway auto-sets `DATABASE_URL` — no action needed

### 3. Set environment variables on Railway

In your Railway project → Variables, add:

```
JWT_SECRET=<generate a long random string>
EA_API_KEY=<choose a secret key for the EA>
VAPID_PUBLIC_KEY=<see below>
VAPID_PRIVATE_KEY=<see below>
VAPID_EMAIL=mailto:your@email.com
APP_URL=https://your-app.railway.app
NODE_ENV=production
```

**Generate VAPID keys** (run locally once):
```bash
npm install
node -e "const wp=require('web-push'); const k=wp.generateVAPIDKeys(); console.log(JSON.stringify(k,null,2))"
```

### 4. Create users (run once after deploy)

```bash
curl -X POST https://your-app.railway.app/api/auth/setup \
  -H "Content-Type: application/json" \
  -d '{
    "setup_key": "YOUR_EA_API_KEY",
    "users": [
      {"username": "you",     "password": "yourpassword",   "display_name": "Your Name",   "role": "admin"},
      {"username": "friend1", "password": "friend1pass",    "display_name": "Friend 1"},
      {"username": "friend2", "password": "friend2pass",    "display_name": "Friend 2"},
      {"username": "friend3", "password": "friend3pass",    "display_name": "Friend 3"}
    ]
  }'
```

### 5. Configure the EA

In the MT5 EA settings:
- **Server URL:** `https://your-app.railway.app/api/ea/push`
- **API Key header:** `X-Api-Key: YOUR_EA_API_KEY`
- **Symbols:** UK100, DE30 (or GER30), XAUUSD, USOIL
- **Timeframe:** D1 only

The EA pushes candles as JSON:
```json
[
  { "symbol": "DE30", "date": "2025-04-24", "open": 24038, "high": 24055, "low": 24006, "close": 24024, "volume": 12345 }
]
```

Test EA connection:
```bash
curl https://your-app.railway.app/api/ea/status \
  -H "X-Api-Key: YOUR_EA_API_KEY"
```

---

## Nightly Schedule (UTC, Mon–Fri)

| Time  | Job |
|-------|-----|
| 22:15 | Classify latest D1 candles |
| 22:20 | Refresh pattern statistics |
| 22:30 | Generate reports + send push notifications |

---

## Manually trigger reports (admin)

```bash
curl -X POST https://your-app.railway.app/api/reports/run \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## API Reference

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/login` | No | Login |
| GET  | `/api/auth/me` | JWT | Current user |
| POST | `/api/auth/setup` | EA Key | Create initial users (once) |
| POST | `/api/auth/change-password` | JWT | Change password |
| POST | `/api/ea/push` | EA Key | Push candle data |
| GET  | `/api/ea/status` | EA Key | EA connection status |
| GET  | `/api/candles/` | JWT | All symbols summary |
| GET  | `/api/candles/:symbol` | JWT | Candles for chart |
| GET  | `/api/candles/:symbol/latest` | JWT | Latest candle |
| GET  | `/api/reports/latest` | JWT | Latest reports all symbols |
| GET  | `/api/reports/:symbol` | JWT | Report history |
| GET  | `/api/reports/:symbol/:date` | JWT | Single report |
| POST | `/api/reports/run` | JWT Admin | Manually run nightly jobs |
| GET  | `/api/push/vapid-public-key` | No | VAPID public key |
| POST | `/api/push/subscribe` | JWT | Subscribe to push |
| POST | `/api/push/unsubscribe` | JWT | Unsubscribe |

---

## Icon generation

Place a 512×512 PNG logo at `/public/icons/icon-512.png` then generate all sizes:

```bash
npm install -g sharp-cli
for size in 72 96 128 144 192 512; do
  sharp -i public/icons/icon-512.png -o public/icons/icon-${size}.png resize ${size}
done
```
