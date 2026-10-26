# Strategi cakupan nasional (hari pertama)

Produk dirancang **nasional sejak hari pertama** dengan pembagian layer: yang benar-benar “seluruh Indonesia” lewat sedikit panggilan API, versus prakiraan cuaca per desa/kelurahan (adm4) yang harus di-cache secara pintar.

## Layer nasional penuh (MVP)

| Layer | Sumber | Cakupan | Refresh |
|-------|--------|---------|---------|
| Gempa terbaru | BMKG TEWS | Seluruh wilayah Indonesia | ~60 detik |
| Gempa M5+ / dirasakan | BMKG TEWS | Nasional | ~60 detik |
| Peringatan dini cuaca | BMKG CAP nowcast | Provinsi aktif + **polygon kecamatan** | 2–3 menit |
| Hotspot kebakaran (API opsional) | NASA FIRMS | Nasional | 2 menit |
| Gempa global (API opsional) | USGS | Cross-check | 60 detik |

Nowcast RSS (`/alerts/nowcast/id`) sudah **nasional**: hanya provinsi yang sedang punya peringatan aktif. Setiap item diperkaya dengan file CAP berisi banyak `polygon` → ditampilkan sebagai GeoJSON di peta.

## Prakiraan cuaca adm4 (~83 ribu kelurahan)

BMKG: `GET https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4={kode}` — **satu kelurahan per request**, batas ~60/menit/IP.

**Tidak** prefetch semua adm4 saat startup. Pola nasional:

1. **On-demand** — klik / search desa → fetch + cache TTL 2 jam.
2. **Prioritas nowcast** — kelurahan di provinsi dengan CAP aktif difetch lebih dulu (antrian).
3. **Rolling refresh** — sisa adm4 di-queue dengan rate limit (mis. 45 req/menit), selesai satu siklus ~30 jam; cukup untuk “cuaca terbaru” non-real-time.
4. **Indeks wilayah** — script `scripts/build_wilayah_index.py` (fase 2) dari data administratif terbuka (kode adm4 + centroid).

Peta default operasional BPBD: **nowcast polygon + gempa + hotspot** = situasi nasional tanpa menunggu 83k fetch.

## Atribusi wajib

Semua respons API menyertakan `attribution: BMKG` dan link ke [data.bmkg.go.id](https://data.bmkg.go.id). UI produk harus menampilkan sumber BMKG secara visible.

## Deploy

Satu instance backend = satu IP keluar ke BMKG. Untuk HA, **jangan** duplicate scheduler tanpa shared cache; gunakan satu worker fetcher atau Redis lock.
