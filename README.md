# Piko Label Printer — GitHub + Vercel Edition

Minimal, tablet-friendly eBay shipping workspace for Piko Cards. **No framework, no build step, no database, and no npm dependencies.** The files in this repository are ready to import into Vercel.

## What works

- Demo orders immediately, even before eBay keys are ready
- Secure password login when `APP_PASSWORD` and `APP_SECRET` are configured
- OAuth authorization for a single eBay seller account (read-only Fulfillment API)
- Paid, not-yet-fulfilled eBay orders, batch selection and search
- PDF **packing slips**: US Letter / 8.5 × 11 in (Canon)
- PDF **address labels**: one adjustable thermal label per order, with Ship from / Ship to side by side (MUNBYN 130B)
- Settings for the return address, label size, font and thank-you message
- One **Prepare both** button generates both PDFs together, ready to open and print
- Responsive Android tablet interface

**Important:** The packing slips are *custom documents based on eBay order data*, not identical copies of eBay's branded packing slip. They do not reproduce its QR code, order receipt formatting, or store banners. The PDF font is Latin-1/WinAnsi-oriented; some non-Western characters may not render properly.

**Printing limitation:** Vercel cannot access local Bluetooth printers. Chrome on Android cannot silently route two PDFs to two different printers. Therefore this edition creates both PDFs in one action, but you still print each one through Android's print UI. The Canon and MUNBYN fields in Settings are **saved preferences only**, not functional printer selection. True one-tap dual-printer printing would require a separately hosted print bridge with durable queueing and access to both printers, or a purpose-built native Android companion for your specific MUNBYN model. The former standalone Node agent is not connected to the Vercel serverless edition.

## 1. Create a GitHub repository

1. Download and **extract** the supplied ZIP. Do not commit the ZIP itself: GitHub will not automatically extract it into a repository.
2. Create an empty GitHub repository named `piko-label-printer` (private recommended).
3. Put the extracted files **at the repository root**, preserving `api/`, `lib/`, and `public/`.
4. Commit/push with GitHub Desktop, or use a terminal:

```bash
cd piko-label-printer-vercel
# Use the URL of your own new GitHub repository:
git init
git add .
git commit -m "Piko Label Printer — Vercel edition"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/piko-label-printer.git
git push -u origin main
```

**Do not** upload `.env` or real API secrets. `.env.example` is intentionally safe to commit.

## 2. Import into Vercel

1. In [vercel.com/new](https://vercel.com/new), choose **Import Git Repository** and select `piko-label-printer`.
2. Keep **Root Directory** as `./`.
3. Choose **Framework Preset: Other** if Vercel asks. Keep **Build Command: none** and **Output Directory: default**, since `public/` holds static assets and `api/` holds the Node.js functions.
4. Deploy. Vercel should give you a `https://<your-project>.vercel.app` address.
5. Before linking your real eBay orders, add the environment variables below and redeploy.

You can test the demo with no credentials at all, but do **not** connect eBay until access is password-protected.

## 3. Environment variables (Vercel → Project → Settings → Environment Variables)

Set for **Production** (and Preview if you actually need those environments). Values must be entered in Vercel, *never in frontend JavaScript or GitHub*.

| Variable | Value |
|---|---|
| `APP_PASSWORD` | A private password, **12+ characters** |
| `APP_SECRET` | A random, stable secret, **32+ characters** (prefer 64 random characters) |
| `EBAY_CLIENT_ID` | Your Production App ID / Client ID |
| `EBAY_CLIENT_SECRET` | Your Production Cert ID / Client Secret |
| `EBAY_RUNAME` | The **eBay-issued RuName**, not your site's URL |
| `EBAY_ENVIRONMENT` | `production` |

**Keep `APP_SECRET` unchanged** after connecting eBay: rotating it invalidates logins and the encrypted eBay authorization cookie. The code prevents using eBay credentials without strong app secrets.

Suggested order: first configure only `APP_PASSWORD` and `APP_SECRET`, redeploy, check that sign-in works. Then add the three eBay variables and redeploy again.

## 4. Authorize eBay

1. Open [eBay Developer Application Keys](https://developer.ebay.com/my/keys), and use a **Production** keyset.
2. Under **eBay Sign-in Settings** create/configure your OAuth redirect URI (RuName).
3. Set **Auth Accepted URL** to the exact stable production URL:

   `https://YOUR-PROJECT.vercel.app/api/oauth/callback`

4. Set **Auth Declined URL** to:

   `https://YOUR-PROJECT.vercel.app/?ebay=denied`

5. If you later choose a custom domain, update the eBay redirect settings and use that same domain consistently.
6. After Vercel redeploys with credentials, visit the app, log in, go to **Settings → Connect eBay**, authorize your seller account.
7. Save your return address in Settings before preparing real labels.

The app requests `sell.fulfillment.readonly`, fetches `NOT_STARTED` orders, and **does not buy shipping labels or mark an order shipped**.

**Account storage:** This Vercel version avoids a database by storing your eBay refresh token in an encrypted `HttpOnly` browser cookie. That means eBay must be connected **once per browser/device**; the authorization is *not* synchronized between your Android tablet and PC. The cookie may expire or be lost when browser data is cleared, requiring you to reconnect. eBay refresh tokens that exceed standard cookie limits would need a database-backed revision instead. Your printer and layout preferences are stored **in that browser's localStorage**, not synced across devices.

**Security:** For personal single-user use only. Use a high-entropy password, HTTPS, a private repo and ideally Vercel firewall/rate-limit controls. The app does not persist customer addresses or PDF files on Vercel disks. Uploaded eBay order data is processed for PDF rendering on demand.

## 5. Printing from Android

1. Open the Vercel URL in Android Chrome.
2. Select one or more orders in Orders.
3. Tap **Prepare both**.
4. Open the **Packing slip** PDF and print it on Canon at **Letter / 100% scale**.
5. Open the **Address label** PDF and print it on MUNBYN 130B at the exact configured thermal media size. Depending on your printer/driver/Android setup, this may require the MUNBYN app to import the PDF. The web app itself cannot force Bluetooth printing.
6. Test one order first; do not assume every printer driver honors PDF page sizes without adjustment.

## Local development / tests

```bash
npm start          # http://localhost:3000
npm test           # Built-in Node.js tests, no dependencies
```

For local production-like testing, copy `.env.example` to `.env` and fill in `APP_PASSWORD` and `APP_SECRET`. `local.mjs` is a local-only server. **Vercel does not run `npm start`; it automatically deploys the individual functions in `api/`.**

## Repo layout

```text
api/
  bootstrap.js, login.js, logout.js, orders.js, settings.js, disconnect.js
  oauth/start.js, oauth/callback.js
  documents/packing.js, documents/labels.js
lib/api.mjs          Vercel-compatible stateless API, OAuth & order normalization
public/              Tablet UI, CSS & frontend JavaScript
pdf.mjs              PDF creator (no external dependencies)
local.mjs            Optional local preview server
vercel.json          Vercel configuration
tests/               PDF generator tests
.env.example         Placeholder names only — no real secrets
```

### API and platform references

- [Vercel — Node.js Functions](https://vercel.com/docs/functions/runtimes/node-js)
- [Vercel — Deploy from Git](https://vercel.com/docs/git)
- [eBay — Fulfillment getOrders](https://developer.ebay.com/develop/api/sell/fulfillment_api/order/getOrders)
- [eBay — OAuth authorization](https://developer.ebay.com/develop/guides/sell/authorization)
