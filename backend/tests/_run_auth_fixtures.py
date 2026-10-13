"""Locally signed, disposable identities for saved-run API tests."""

from datetime import datetime, timedelta, timezone

import jwt

from backend.core.auth_deps import JWT_ALGORITHM
from backend.core.runtime_secrets import runtime_secret


def auth_headers(owner_id: str, *, expired: bool = False) -> dict[str, str]:
    expiry = datetime.now(timezone.utc) + timedelta(minutes=-1 if expired else 5)
    token = jwt.encode(
        {"sub": owner_id, "type": "access", "exp": expiry},
        runtime_secret("JWT_SECRET"),
        algorithm=JWT_ALGORITHM,
    )
    return {"Authorization": f"Bearer {token}"}
