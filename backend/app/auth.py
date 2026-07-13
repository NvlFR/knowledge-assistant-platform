"""Minimal shared-password authentication.

A single password (``APP_PASSWORD``) gates the whole API — enough to keep a
VPS-deployed internal tool private without standing up a user store. On login we
mint a stateless HMAC-signed token (no DB, no session store) that the frontend
sends as a Bearer header on every subsequent request.
"""

import base64
import hashlib
import hmac
import os
import time

from fastapi import Depends, Header, HTTPException, status

APP_PASSWORD = os.environ.get("APP_PASSWORD", "")
# Signing key for tokens. Falls back to a value derived from the password so the
# deployer only *has* to set APP_PASSWORD, but a distinct AUTH_SECRET is better.
_SECRET = (
    os.environ.get("AUTH_SECRET")
    or hashlib.sha256(f"ka::{APP_PASSWORD}".encode()).hexdigest()
).encode()
TOKEN_TTL_SECONDS = int(os.environ.get("AUTH_TOKEN_TTL_SECONDS", str(7 * 24 * 3600)))

AUTH_ENABLED = bool(APP_PASSWORD)


def _sign(payload: str) -> str:
    digest = hmac.new(_SECRET, payload.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


def create_token() -> str:
    exp = str(int(time.time()) + TOKEN_TTL_SECONDS)
    return f"{exp}.{_sign(exp)}"


def _token_valid(token: str) -> bool:
    try:
        exp_str, sig = token.split(".", 1)
    except ValueError:
        return False
    if not hmac.compare_digest(sig, _sign(exp_str)):
        return False
    try:
        return int(exp_str) > int(time.time())
    except ValueError:
        return False


def check_password(candidate: str) -> bool:
    # Constant-time comparison to avoid leaking the password via timing.
    return bool(APP_PASSWORD) and hmac.compare_digest(candidate, APP_PASSWORD)


async def require_auth(authorization: str | None = Header(default=None)) -> None:
    """FastAPI dependency guarding protected routes. A no-op when no password is
    configured, so local dev without APP_PASSWORD keeps working."""
    if not AUTH_ENABLED:
        return
    token = ""
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    if not _token_valid(token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )


AuthDep = Depends(require_auth)
