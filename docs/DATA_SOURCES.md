# Sumber data terbuka (MVP)

| ID | Provider | Endpoint | Key |
|----|----------|----------|-----|
| `bmkg-earthquake-latest` | BMKG | `https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json` | Tidak |
| `bmkg-earthquake-recent` | BMKG | `https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json` | Tidak |
| `bmkg-earthquake-felt` | BMKG | `https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json` | Tidak |
| `bmkg-nowcast-rss` | BMKG | `https://www.bmkg.go.id/alerts/nowcast/id` | Tidak |
| `bmkg-nowcast-cap` | BMKG | `https://www.bmkg.go.id/alerts/nowcast/id/{code}_alert.xml` | Tidak |
| `bmkg-weather-adm4` | BMKG | `https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4={adm4}` | Tidak |
| `nasa-firms-nrt` | NASA FIRMS | Area CSV API (bbox Indonesia) | **FIRMS_MAP_KEY** |
| `usgs-earthquake-query` | USGS | FDSN Event `query` (M4+, 7 hari, bbox ID) | Tidak |

Dokumentasi resmi: [Data Gempabumi Terbuka](https://data.bmkg.go.id/gempabumi/), [Peringatan Dini Cuaca](https://data.bmkg.go.id/peringatan-dini-cuaca/).
