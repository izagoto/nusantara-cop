import time
from typing import Any, Generic, TypeVar

T = TypeVar("T")


class TTLCache(Generic[T]):
    def __init__(self) -> None:
        self._value: T | None = None
        self._expires_at: float = 0.0

    def get(self) -> T | None:
        if self._value is None or time.monotonic() >= self._expires_at:
            return None
        return self._value

    def set(self, value: T, ttl_seconds: float) -> None:
        self._value = value
        self._expires_at = time.monotonic() + ttl_seconds

    def clear(self) -> None:
        self._value = None
        self._expires_at = 0.0


class KeyedTTLCache(Generic[T]):
    def __init__(self) -> None:
        self._entries: dict[str, tuple[T, float]] = {}

    def get(self, key: str) -> T | None:
        entry = self._entries.get(key)
        if entry is None:
            return None
        value, expires_at = entry
        if time.monotonic() >= expires_at:
            del self._entries[key]
            return None
        return value

    def set(self, key: str, value: T, ttl_seconds: float) -> None:
        self._entries[key] = (value, time.monotonic() + ttl_seconds)
