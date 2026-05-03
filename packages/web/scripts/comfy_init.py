"""Relit web UI — registers HTTP routes at /relit serving the bundled web app.

Drop this whole folder (relit/) into <ComfyUI>/custom_nodes/. The web/
subfolder must contain the Vite-built index.html + assets/. ComfyUI
discovers custom_nodes on startup and runs this module's import side-effects
to register the routes.
"""

import os
from aiohttp import web
from server import PromptServer

WEB_DIR = os.path.join(os.path.dirname(__file__), "web")


def _safe_join(rel: str) -> str | None:
    full = os.path.normpath(os.path.join(WEB_DIR, rel))
    if not full.startswith(WEB_DIR):
        return None
    return full


@PromptServer.instance.routes.get("/relit")
async def relit_root(_request: web.Request) -> web.Response:
    index = os.path.join(WEB_DIR, "index.html")
    if not os.path.isfile(index):
        return web.Response(status=503, text="Relit web bundle missing. Re-run install.")
    return web.FileResponse(index)


@PromptServer.instance.routes.get(r"/relit/{tail:.*}")
async def relit_assets(request: web.Request) -> web.Response:
    tail = request.match_info["tail"] or "index.html"
    full = _safe_join(tail)
    if full is None:
        return web.Response(status=403)
    if os.path.isfile(full):
        return web.FileResponse(full)
    return web.Response(status=404)


NODE_CLASS_MAPPINGS: dict = {}
NODE_DISPLAY_NAME_MAPPINGS: dict = {}
