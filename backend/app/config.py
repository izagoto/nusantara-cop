import os

from dotenv import load_dotenv

load_dotenv()

BMKG_USER_AGENT = os.getenv(
    "BMKG_USER_AGENT",
    "IndonesiaCOP/0.1 (national disaster weather COP; +https://local)",
)
NOWCAST_REFRESH_SECONDS = int(os.getenv("NOWCAST_REFRESH_SECONDS", "180"))
EARTHQUAKE_REFRESH_SECONDS = int(os.getenv("EARTHQUAKE_REFRESH_SECONDS", "60"))
NOWCAST_CAP_CONCURRENCY = int(os.getenv("NOWCAST_CAP_CONCURRENCY", "4"))
WEATHER_CACHE_TTL_SECONDS = int(os.getenv("WEATHER_CACHE_TTL_SECONDS", "7200"))
WEATHER_QUEUE_ENABLED = os.getenv("WEATHER_QUEUE_ENABLED", "true").lower() in (
    "1",
    "true",
    "yes",
)
WEATHER_QUEUE_MAX_PER_MINUTE = int(os.getenv("WEATHER_QUEUE_MAX_PER_MINUTE", "45"))
WEATHER_ROLLING_BATCH_SIZE = int(os.getenv("WEATHER_ROLLING_BATCH_SIZE", "12"))
SUPPORT_REFRESH_SECONDS = int(os.getenv("SUPPORT_REFRESH_SECONDS", "300"))
FIRMS_MAP_KEY = os.getenv("FIRMS_MAP_KEY", "").strip()
FIRMS_SOURCE = os.getenv("FIRMS_SOURCE", "VIIRS_SNPP_NRT")
FIRMS_DAY_RANGE = int(os.getenv("FIRMS_DAY_RANGE", "1"))

INDONESIA_WEST = 94.0
INDONESIA_SOUTH = -11.5
INDONESIA_EAST = 141.5
INDONESIA_NORTH = 6.5
GRID_CELL_DEG = float(os.getenv("GRID_CELL_DEG", "0.2"))

BMKG_TEWS_BASE = "https://data.bmkg.go.id/DataMKG/TEWS"
BMKG_NOWCAST_RSS = "https://www.bmkg.go.id/alerts/nowcast/id"
BMKG_NOWCAST_CAP_BASE = "https://www.bmkg.go.id/alerts/nowcast/id"
BMKG_WEATHER_API = "https://api.bmkg.go.id/publik/prakiraan-cuaca"

ATTRIBUTION = {
    "provider": "BMKG",
    "name": "Badan Meteorologi, Klimatologi, dan Geofisika",
    "url": "https://data.bmkg.go.id",
    "notice": "Wajib menampilkan BMKG sebagai sumber data pada aplikasi.",
}
