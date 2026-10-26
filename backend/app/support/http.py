import httpx

from app.config import BMKG_USER_AGENT


def support_client(*, read_seconds: float = 45.0) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=httpx.Timeout(read_seconds, connect=12.0),
        headers={"User-Agent": BMKG_USER_AGENT},
        follow_redirects=True,
    )
