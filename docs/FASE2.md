# Fase 2 — Indeks wilayah & antrian cuaca adm4

Status implementasi (ringkas):

| Task | Status | Catatan |
|------|--------|---------|
| **A** Script indeks nasional | 🟡 MVP | `scripts/build_wilayah_index.py` → `backend/app/data/wilayah_index.json` |
| **B** Antrian prioritas CAP | 🟡 MVP | Setelah refresh nowcast, adm4 provinsi alert masuk antrian |
| **C** Rolling refresh adm4 | 🟡 MVP | Batch kecil dari indeks (jika ada), rate limit per menit |

Legenda: ✅ selesai · 🟡 fondasi/MVP · ⬜ belum

---

## A — Indeks wilayah nasional

**Tujuan:** ~83k kode adm4 + nama + centroid untuk pencarian dan antrian cuaca.

**Cara pakai:**

```bash
# CSV wajib kolom: adm4,name,lon,lat — opsional: kind,aliases (|),province
python3 scripts/build_wilayah_index.py \
  --input /path/ke/dataset_adm4.csv \
  --output backend/app/data/wilayah_index.json
```

Commit `wilayah_index.json` opsional (file besar → Git LFS atau artefak release).

**Kriteria selesai (penuh):**

- [ ] Sumber data administratif terbuka terdokumentasi di repo
- [ ] Pencarian `/api/v1/wilayah/search` memakai indeks penuh (bukan hanya preset)
- [ ] Validasi kode adm4 & bbox Indonesia

---

## B — Antrian prioritas provinsi CAP aktif

**Tujuan:** Kelurahan/desa di provinsi dengan peringatan cuaca aktif di-fetch BMKG lebih dulu.

**Perilaku MVP:**

- Setelah `refresh_nowcast`, provinsi dari `provinces_with_alerts` → cocokkan preset/indeks → `enqueue` adm4 (prioritas CAP).
- Job `process_weather_queue` memanggil API BMKG dengan batas menit (env).

**Kriteria selesai (penuh):**

- [ ] Mapping provinsi CAP → banyak adm4 per provinsi (dari indeks, bukan satu ibukota saja)
- [ ] Metrik di `/api/v1/health`: depth antrian, fetch/menit
- [ ] Tes integrasi dengan mock BMKG

---

## C — Rolling refresh nasional

**Tujuan:** Sisa adm4 di-refresh bergiliran (~45 req/menit), siklus panjang tanpa melanggar limit BMKG.

**Perilaku MVP:**

- Jika `wilayah_index.json` ada, setiap menit tambah batch kecil adm4 ke antrian prioritas rolling.
- Lewati adm4 yang masih ada di cache TTL.

**Kriteria selesai (penuh):**

- [ ] Estimasi siklus penuh (~30 jam) terdokumentasi dari jumlah adm4
- [ ] Pause antrian saat nowcast job sedang berat (opsional)

---

## Salin ke GitHub Issues

Buat 3 issue di https://github.com/izagoto/nusantara-cop/issues/new

### Issue 1 — `[Fase 2A] Indeks wilayah adm4 nasional`

**Body:**

```
## Ringkasan
Bangun dan integrasikan indeks ~83k adm4 (kode, nama, centroid) untuk pencarian COP.

## Tugas
- [ ] Dokumentasi sumber dataset administratif terbuka
- [ ] `scripts/build_wilayah_index.py` (CSV → wilayah_index.json)
- [ ] `wilayah.py` baca indeks penuh + fallback preset
- [ ] Uji `/api/v1/wilayah/search` dengan sample adm4

## Referensi
docs/FASE2.md, docs/NASIONAL.md
```

### Issue 2 — `[Fase 2B] Antrian cuaca prioritas CAP`

**Body:**

```
## Ringkasan
Scheduler mengisi cache cuaca adm4 untuk wilayah di provinsi dengan CAP aktif.

## Tugas
- [ ] Enqueue adm4 dari provinsi `provinces_with_alerts` setelah refresh nowcast
- [ ] Prioritas antrian di atas rolling refresh
- [ ] Health/metrics: kedalaman antrian cuaca

## Referensi
backend/app/bmkg/weather_queue.py, docs/FASE2.md
```

### Issue 3 — `[Fase 2C] Rolling refresh cuaca adm4`

**Body:**

```
## Ringkasan
Refresh bergiliran seluruh adm4 (rate limit BMKG ~45/menit).

## Tugas
- [ ] Batch rolling dari wilayah_index.json
- [ ] Lewati adm4 yang masih valid di cache TTL
- [ ] Dokumentasi estimasi siklus penuh

## Referensi
WEATHER_QUEUE_MAX_PER_MINUTE di .env.example, docs/FASE2.md
```

---

## Environment

| Variabel | Default | Fungsi |
|----------|---------|--------|
| `WEATHER_QUEUE_ENABLED` | `true` | Aktifkan job antrian |
| `WEATHER_QUEUE_MAX_PER_MINUTE` | `45` | Maks fetch BMKG adm4 per menit |
| `WEATHER_ROLLING_BATCH_SIZE` | `12` | Adm4 rolling ditambah per menit (jika indeks ada) |
