# Clicks (Patched Build)

This is a clean, working baseline that fixes the broken upload routes, the promotion image rendering, and the claim flow.

## Run locally

```bash
npm i
npm start
```

Then open http://localhost:3000

## What changed

- Fixed the **uploads**: `/upload` (venues) and `/upload/promo` (promos) are defined once, at top-level. Files save to `Media/Venues/` and `Media/Promotions/` and return relative paths.
- Fixed **promotions** API and rendering: `GET /api/promotions` joins venues and returns `image` properly; the frontend chooses `promotion.image || venue.image || Media/logo.png`.
- Changed **claim flow** to require a button click. It calls `POST /api/promotions/claim` and then injects the QR and code.
- Added a lightweight **analytics** endpoint `/api/promotions/summary` for the table in the Analytics panel.
- Included a minimal **Admin** panel: save a venue (then create a promo for that venue).

> NOTE: This is a baseline so you and I can debug comfortably. If you need server-side admin auth or specific admin flows, I can add that next.
