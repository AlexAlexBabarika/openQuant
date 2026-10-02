"""Curated local demo: uvicorn backend.trial_app:app --host 127.0.0.1."""

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from backend.routes.trial_routes import router

FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"


def create_app(frontend_dist: Path = FRONTEND_DIST) -> FastAPI:
    demo = FastAPI(title="OpenQuant — Strategy on Trial", version="1.0.0")
    demo.include_router(router)

    @demo.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "mode": "trial-only"}

    @demo.get("/", response_class=HTMLResponse)
    @demo.get("/index.html", response_class=HTMLResponse, include_in_schema=False)
    async def index() -> HTMLResponse:
        entry = frontend_dist / "index.html"
        if not entry.is_file():
            return HTMLResponse(
                "<h1>OpenQuant demo frontend is not built.</h1>"
                "<p>Run npm --prefix frontend ci, python gen_dashboard_fixture.py, "
                "then npm --prefix frontend run build from the repository root.</p>",
                status_code=503,
            )
        html = entry.read_text(encoding="utf-8").replace(
            "<head>", '<head><meta name="openquant-mode" content="trial-only" />', 1
        )
        return HTMLResponse(html)

    for directory in ("assets", "fonts"):
        if (frontend_dist / directory).is_dir():
            demo.mount(
                f"/{directory}",
                StaticFiles(directory=frontend_dist / directory),
                name=directory,
            )
    return demo


app = create_app()
