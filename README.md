# [nusantara-cop](https://github.com/izagoto/nusantara-cop)

Peta situasi (**COP** = *Common Operational Picture*) untuk Nusantara: agregator **data terbuka BMKG** — peringatan cuaca (CAP), gempa (TEWS), cuaca adm4, dan koroplet analitik di MapLibre.

**Bukan layanan resmi BMKG/BNPB.** Wajib tampilkan atribusi BMKG saat dipakai.

---

## Fitur

- Peta globe: basemap Analitik / Satelit / Pemukiman  
- Layer: polygon CAP + gempa (toggle)  
- Panel: cari adm4, intel brief, tabel CAP aktif  
- API REST + scheduler refresh otomatis  

Detail data & atribusi: [docs/PROVENANCE.md](docs/PROVENANCE.md) · [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md)

---

## Jalankan (lokal)

```bash
cp .env.example .env    # dari root repo; jangan commit .env
```

**Backend** — port 8080:

```bash
cd backend && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8080
```

**Frontend** — port 5173:

```bash
cd frontend && npm install && npm run dev
```

Buka http://127.0.0.1:5173 (backend harus sudah jalan).

**Docker:** `docker compose up --build` → UI http://localhost:3000 · API http://localhost:8080

---

## API (inti)

| Endpoint | Fungsi |
|----------|--------|
| `GET /api/v1/health` | Status scheduler & cache |
| `GET /api/v1/nowcast/geojson` | Polygon CAP untuk peta |
| `GET /api/v1/earthquake/latest` | Gempa terbaru |
| `GET /api/v1/weather/adm4/{kode}` | Cuaca 3 hari per adm4 |
| `GET /api/v1/wilayah/search?q=` | Cari wilayah |
| `GET /api/v1/viz/analytics/geojson` | Koroplet analitik |
| `GET /api/v1/provenance` | Sumber & waktu ingest |

Env: [.env.example](.env.example) · Cakupan nasional: [docs/NASIONAL.md](docs/NASIONAL.md)

---

## Struktur

```text
backend/    FastAPI + BMKG
frontend/   Vite + MapLibre
docs/       Spesifikasi & cakupan nasional
scripts/    Indeks adm4
```
