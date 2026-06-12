# BMViewGB Free Deployment Guide

This guide describes the zero-paid setup for making BMViewGB available at a fixed public URL while keeping the runtime data on the server side.

## Target Architecture

```text
Render Static Site (free)
  https://wangy1lu-bmviewgb-frontend.onrender.com
        |
        | calls
        v
Render Web Service (free)
  https://wangy1lu-bmviewgb-backend.onrender.com/api
        |
        | downloads at startup if needed
        v
Public data bundle
  GitHub Release asset, for example bmviewgb-data.zip
```

Users only open the frontend URL. They do not download CSV files and do not run a local backend.

## What Is Already Configured

- `render.yaml` defines a free Render backend and a free Render static frontend.
- `frontend/src/services/api.js` reads `REACT_APP_API_BASE_URL`, falling back to local development at `http://localhost:8000/api`.
- `backend/core/settings.py` reads production settings from environment variables.
- `backend/api/management/commands/bootstrap_data.py` downloads and extracts the runtime data bundle before Gunicorn starts.
- `backend/scripts/package_data.py` creates the runtime data bundle from local `backend/data`.

## 1. Build The Runtime Data Bundle

Run this from the repository root:

```bash
python backend/scripts/package_data.py --strict
```

The output is:

```text
dist/bmviewgb-data.zip
```

This bundle includes the files needed by the current API endpoints:

- yearly `*boadf_processed.csv` files
- yearly `core/core_data_*.csv` files
- node and mapping CSV files used by node views

To preview the manifest without writing the zip:

```bash
python backend/scripts/package_data.py --strict --dry-run
```

## 2. Upload The Data Bundle For Free

Recommended: upload `dist/bmviewgb-data.zip` as a GitHub Release asset, not as a normal repository file.

After upload, copy the release asset URL. It should look similar to:

```text
https://github.com/<your-user>/<your-repo>/releases/download/bmviewgb-data-v1/bmviewgb-data.zip
```

The repository or release asset must be public for Render to download it without credentials.

## 3. Deploy With Render Blueprint

1. Push this repository to GitHub.
2. In Render, create a new Blueprint from the repository.
3. Render will read `render.yaml`.
4. When Render prompts for `DATA_BUNDLE_URL`, paste the GitHub Release asset URL from step 2.
5. Create the services.

Expected free URLs:

```text
https://wangy1lu-bmviewgb-frontend.onrender.com
https://wangy1lu-bmviewgb-backend.onrender.com
```

If Render forces different service names, update these environment variables in the Render dashboard:

- frontend `REACT_APP_API_BASE_URL`: `https://<backend-service>.onrender.com/api`
- backend `FRONTEND_ORIGINS`: `https://<frontend-service>.onrender.com`

The backend also allows HTTPS origins matching `*.onrender.com` through `CORS_ALLOWED_ORIGIN_REGEXES`.

## 4. Expected Free-Tier Behavior

This setup is fully free, but it has free-tier tradeoffs:

- The backend can sleep when unused.
- The first request after sleep can be slow.
- If the backend instance starts without local data, it downloads and extracts the data bundle before serving requests.
- Render's free service filesystem is not durable, so the data bundle URL must remain available.

For best results, keep `bmviewgb-data.zip` as small as possible while still covering the required API features.

## 5. Local Checks

Verify the local data directory satisfies the runtime manifest:

```bash
cd backend
python manage.py bootstrap_data --require-data
```

Test the backend with local data:

```bash
cd backend
python manage.py runserver
```

Test the frontend locally:

```bash
cd frontend
npm start
```

Local development still works without setting deployment environment variables.
