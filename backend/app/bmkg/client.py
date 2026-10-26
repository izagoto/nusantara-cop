import httpx

from app.config import BMKG_USER_AGENT


def bmkg_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=httpx.Timeout(30.0, connect=10.0),
        headers={"User-Agent": BMKG_USER_AGENT},
        follow_redirects=True,
    )
