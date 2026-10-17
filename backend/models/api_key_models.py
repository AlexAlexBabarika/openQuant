"""
Pydantic models for API key endpoints.
"""

from enum import Enum

from pydantic import BaseModel, Field


class ApiKeyProvider(str, Enum):
    twelvedata = "twelvedata"
    alphavantage = "alphavantage"
    massive = "massive"
    binance = "binance"
    tradier = "tradier"
    tradier_sandbox = "tradier_sandbox"


class ApiKeyCreateRequest(BaseModel):
    provider: ApiKeyProvider
    api_key: str = Field(..., min_length=1, max_length=512)


class ApiKeyUpdateRequest(BaseModel):
    api_key: str = Field(..., min_length=1, max_length=512)


class ApiKeyInfo(BaseModel):
    id: str
    provider: ApiKeyProvider
    key_prefix: str
    created_at: str
    updated_at: str


class ApiKeyListResponse(BaseModel):
    keys: list[ApiKeyInfo]


class ApiKeyAuditEntry(BaseModel):
    id: str
    provider: str
    action: str
    created_at: str


class ApiKeyAuditResponse(BaseModel):
    entries: list[ApiKeyAuditEntry]
