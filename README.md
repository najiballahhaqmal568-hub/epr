# سیستم مدیریت بوت فروشی (Shoe Shop ERP)

اپلیکیشن موبایل برای مدیریت کسب‌وکار بوت فروشی — پرچون و عمده.

A mobile ERP app (installable PWA) for a retail + wholesale shoe business.
Dari (فارسی) interface, RTL layout, Afghani (؋) currency, **works fully offline** —
all data is stored on the phone (IndexedDB), no server or account needed.

## امکانات / Features

- **گدام (Inventory)** — بوت‌ها با سایز، رنگ، قیمت خرید/پرچون/عمده، هشدار موجودی کم
- **فروش (Sales/POS)** — فروش پرچون و عمده، دریافت نقدی، باقی به حساب قرض مشتری
- **خرید (Purchases)** — خرید از تأمین‌کنندگان، افزایش خودکار گدام، حساب قرض ما
- **مشتریان (Customers)** — حساب قرض، دریافت پول، تاریخچه هر مشتری
- **داشبورد (Dashboard)** — فروش و مفاد امروز، ارزش گدام، طلب‌ها، موجودی کم
- **بکاپ (Backup)** — دانلود و برگرداندن فایل بکاپ JSON

## Run locally

```bash
npm install
npm run dev
```

## Deploy (free hosting)

Pushing to `main` deploys automatically to **GitHub Pages** via the included
workflow (enable Pages → Source: "GitHub Actions" in repo settings once).
Open the Pages URL on your phone in Chrome and choose **"Add to Home Screen"** —
after that the app opens and works with no internet.

## Tech

React 18 + TypeScript + Vite · Dexie (IndexedDB) · Tailwind CSS 4 · vite-plugin-pwa
