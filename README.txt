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

## Cloudinary / Image uploads

This project is configured to upload images to Cloudinary and serve them from Cloudinary CDN. The server will:

- Accept uploads via a unified POST `/upload` endpoint (multipart form-data with field `file`, or JSON with `image` being a data URI or base64 string). Optionally pass `?folder=promotions` to place the image in promotions folder.
- Automatically migrate existing local `Media/...` images to Cloudinary when clients request `/api/venues` or `/api/promotions`. The DB will be updated to store the Cloudinary secure URL so front-ends receive CDN URLs.

Required environment variables (set these in Render or your environment):

- `CLOUDINARY_CLOUD_NAME` — your Cloudinary cloud name
- `CLOUDINARY_API_KEY` — Cloudinary API key
- `CLOUDINARY_API_SECRET` — Cloudinary API secret

On Render: go to your service's Dashboard → Settings → Environment and add the three variables above. After setting them, redeploy (or restart) the service so the server picks up the credentials.

Local dev: create a `.env` with these values (not committed to git).

Example upload payloads:

Multipart form (file field `file`):

	POST /upload?folder=venues

JSON (base64 data):

	POST /upload
	Content-Type: application/json
	{ "image": "data:image/png;base64,iVBORw0KG...", "filename": "logo.png", "folder": "promotions" }

Response: { "url": "https://res.cloudinary.com/.../image.jpg", "public_id": "..." }
