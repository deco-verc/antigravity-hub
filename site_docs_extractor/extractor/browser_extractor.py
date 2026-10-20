from __future__ import annotations

from collections.abc import Callable


LogFn = Callable[[str], None]


class BrowserHtmlFetcher:
    def __init__(self, timeout_ms: int = 30000, log: LogFn | None = None) -> None:
        self.timeout_ms = timeout_ms
        self.log = log
        self._playwright = None
        self._browser = None
        self._page = None

    def __enter__(self) -> "BrowserHtmlFetcher":
        try:
            from playwright.sync_api import sync_playwright
        except ImportError as exc:
            raise RuntimeError("Playwright nao esta instalado. Rode: pip install -r requirements.txt") from exc

        if self.log:
            self.log("[PLAYWRIGHT] Abrindo navegador headless.")

        try:
            self._playwright = sync_playwright().start()
            self._browser = self._playwright.chromium.launch(headless=True)
            self._page = self._browser.new_page()
            self._page.set_default_timeout(self.timeout_ms)
            return self
        except Exception as exc:
            self.close()
            raise RuntimeError(
                "Falha ao abrir Chromium do Playwright. Rode: python -m playwright install chromium"
            ) from exc

    def __exit__(self, exc_type, exc, traceback) -> None:
        self.close()

    def fetch_html(self, url: str) -> str:
        if self._page is None:
            raise RuntimeError("Navegador Playwright nao foi inicializado.")

        if self.log:
            self.log(f"[PLAYWRIGHT] Carregando URL atual: {url}")

        self._page.goto(url, wait_until="domcontentloaded", timeout=self.timeout_ms)
        try:
            self._page.wait_for_load_state("networkidle", timeout=5000)
        except Exception:
            pass

        html = self._page.content()
        if self.log:
            self.log(f"[PLAYWRIGHT] HTML capturado ({len(html)} caracteres).")
        return html

    def close(self) -> None:
        try:
            if self._page is not None:
                self._page.close()
        finally:
            self._page = None

        try:
            if self._browser is not None:
                self._browser.close()
        finally:
            self._browser = None

        try:
            if self._playwright is not None:
                self._playwright.stop()
        finally:
            self._playwright = None

        if self.log:
            self.log("[PLAYWRIGHT] Browser fechado.")
