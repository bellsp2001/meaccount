"""
Route Inventory Service — introspects the actual live FastAPI app to produce
a real API reference (not hand-maintained docs that drift out of sync with
the code). Every route listed here is genuinely registered and reachable.
"""
from typing import Dict, List
from fastapi import FastAPI
from schemas.readiness import RouteInventoryItem, RouteInventoryResponse


def get_route_inventory(app: FastAPI) -> RouteInventoryResponse:
    routes: List[RouteInventoryItem] = []
    by_tag: Dict[str, int] = {}

    for route in app.routes:
        methods = sorted(getattr(route, "methods", set()) - {"HEAD", "OPTIONS"})
        if not methods:
            continue
        path = getattr(route, "path", "")
        if path.startswith("/openapi") or path == "/docs" or path == "/redoc":
            continue

        tags = list(getattr(route, "tags", []) or [])
        summary = getattr(route, "summary", None) or getattr(route, "name", None)

        routes.append(RouteInventoryItem(path=path, methods=methods, tags=tags, summary=summary))

        for tag in (tags or ["untagged"]):
            by_tag[tag] = by_tag.get(tag, 0) + 1

    routes.sort(key=lambda r: r.path)

    return RouteInventoryResponse(total_routes=len(routes), by_tag=by_tag, routes=routes)
