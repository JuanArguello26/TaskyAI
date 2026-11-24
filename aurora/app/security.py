"""Límite de intentos fallidos de PIN (web y Telegram) para evitar que lo adivinen."""

import threading
import time
from collections import defaultdict, deque


class FailLimiter:
    def __init__(self, max_fails: int, window_s: int) -> None:
        self.max_fails, self.window = max_fails, window_s
        self._fails: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def _prune(self, key: str, now: float) -> deque:
        q = self._fails[key]
        while q and now - q[0] > self.window:
            q.popleft()
        return q

    def blocked(self, *keys: str) -> bool:
        now = time.monotonic()
        with self._lock:
            return any(len(self._prune(k, now)) >= self.max_fails for k in keys)

    def fail(self, *keys: str) -> None:
        now = time.monotonic()
        with self._lock:
            for k in keys:
                self._prune(k, now).append(now)

    def reset(self) -> None:
        with self._lock:
            self._fails.clear()


# 5 intentos fallidos por persona cada 15 min; 20 en total cada 15 min.
per_client = FailLimiter(5, 15 * 60)
global_web = FailLimiter(20, 15 * 60)
global_bot = FailLimiter(20, 15 * 60)
