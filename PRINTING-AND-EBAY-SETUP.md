# Android printer setup and eBay secrets
- The application is a normal website. Browsers do not expose an API to enumerate local Wi-Fi printers, persist selected system printers or silently print two jobs to different devices.
- In Settings, click **Choose Wi-Fi printer** on the Canon row to open a sample Letter document and the Android print chooser. Printer discovery comes from Android's installed print service.
- The MUNBYN ITPP130B uses Bluetooth. It may not be visible to the Android Wi-Fi printer chooser; printing may require the manufacturer's Android app.
- The app's **Prepare both** button creates two PDFs. It does not silently dispatch two print jobs.
- To print to different devices from one tap, build/install a dedicated native Android printing bridge after confirming both devices' protocol support.

## eBay OAuth
Use your Vercel project **Settings → Environment Variables**. Target **Production**. Store `EBAY_CLIENT_SECRET`, `APP_PASSWORD` and `APP_SECRET` as Secret variables, with the following environment variables:
```
EBAY_CLIENT_ID=YOUR_PRODUCTION_APP_ID
EBAY_CLIENT_SECRET=YOUR_PRODUCTION_CERT_ID
EBAY_RUNAME=YOUR_PRODUCTION_EBAY_RUNAME
EBAY_ENVIRONMENT=production
APP_PASSWORD=YOUR_STRONG_PASSWORD_AT_LEAST_12_CHARACTERS
APP_SECRET=RANDOM_VALUE_AT_LEAST_32_CHARACTERS
```
Use an unpredictable cryptographic random APP_SECRET (for example, Node.js: `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`). Never commit real credentials to GitHub or send them in chat. eBay OAuth accepted URL: `https://pikolabel.vercel.app/api/oauth/callback`. The RuName is the eBay-provided name, NOT the accepted callback URL. Redeploy after adding environment variables. Then use **Connect eBay** from the application's Settings.
