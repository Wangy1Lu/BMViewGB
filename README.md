# BMViewGB

BMViewGB is a Django and React web platform for visualising Great Britain
Balancing Mechanism results at regional and node-level spatial resolutions.
The current version includes the regional GSP Group map, NMS/GNode drill-down
views, interconnector-flow display, missing-data fallback fetching, mapping
coverage summaries, and Render deployment support.

## Prerequisites

- Python 3.10
- Node.js and npm

## Runtime Data

Large runtime datasets are intentionally not committed to GitHub. The backend
expects the files listed in `backend/api/services/data_manifest.py`, including
the yearly processed BOA CSV files, yearly core aggregate files, BMU mapping
files, node mapping files, and coverage summaries.

For local development, place those files under `backend/data/` using the same
relative paths as the manifest. For hosted deployment, create a zip bundle from
a complete local data directory:

```bash
python backend/scripts/package_data.py --strict
```

Upload the generated bundle to a public release/storage location and set
`DATA_BUNDLE_URL` or `BMVIEWGB_DATA_BUNDLE_URL` in the backend environment.
The deployment startup command runs `python manage.py bootstrap_data
--require-data` to download and extract the bundle before serving requests.

## Backend

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r backend/requirements.txt
cd backend
python manage.py migrate
python manage.py bootstrap_data --require-data
python manage.py runserver
```

The local API is served at `http://127.0.0.1:8000/api`.

## Frontend

```bash
cd frontend
npm install
npm start
```

The local frontend is served at `http://localhost:3000`. To point it at a
non-local backend, set `REACT_APP_API_BASE_URL` before running or building the
frontend.

## Production Build

```bash
cd frontend
npm run build
```

## Free Public Deployment

This project includes a zero-paid deployment path using Render free services and
a public runtime data bundle. See `docs/free_deployment.md`.
