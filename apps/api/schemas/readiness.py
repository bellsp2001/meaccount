from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime


class ReadinessCheckResult(BaseModel):
    check_id:   str
    category:   str    # "config" | "database" | "security" | "tests" | "dependencies"
    name:       str
    status:     str    # "pass" | "fail" | "warning"
    detail:     str
    blocking:   bool   # True = must fix before go-live; False = advisory


class ReadinessReportResponse(BaseModel):
    scan_date:        datetime
    overall_status:   str    # "ready" | "not_ready" | "ready_with_warnings"
    total_checks:     int
    passed:           int
    failed:           int
    warnings:         int
    blocking_failures: int
    checks:           List[ReadinessCheckResult]


class RouteInventoryItem(BaseModel):
    path:        str
    methods:     List[str]
    tags:        List[str]
    summary:     Optional[str] = None


class RouteInventoryResponse(BaseModel):
    total_routes:  int
    by_tag:        Dict[str, int]
    routes:        List[RouteInventoryItem]
