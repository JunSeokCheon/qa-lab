from __future__ import annotations

from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt

from app.config import ACCESS_TOKEN_EXPIRE_GRACE_MINUTES, JWT_ALGORITHM, JWT_SECRET_KEY


def verify_password(plain_password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8"), password_hash.encode("utf-8"))


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def create_access_token(subject: str, role: str, expires_delta: timedelta) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": subject,
        "role": role,
        "token_type": "access",
        "iat": int(now.timestamp()),
        "exp": int((now + expires_delta).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def create_refresh_token(subject: str, role: str, expires_delta: timedelta, *, remember_me: bool = False) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": subject,
        "role": role,
        "token_type": "refresh",
        "remember_me": remember_me,
        "iat": int(now.timestamp()),
        "exp": int((now + expires_delta).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        token_type = payload.get("token_type")
        if token_type and token_type != "access":
            raise ValueError("유효하지 않은 토큰입니다.")
        return payload
    except JWTError as exc:
        if ACCESS_TOKEN_EXPIRE_GRACE_MINUTES <= 0:
            raise ValueError("유효하지 않은 토큰입니다.") from exc

        # Emergency fallback: allow recently expired tokens for a short grace window.
        try:
            payload = jwt.decode(
                token,
                JWT_SECRET_KEY,
                algorithms=[JWT_ALGORITHM],
                options={"verify_exp": False},
            )
        except JWTError as inner_exc:
            raise ValueError("유효하지 않은 토큰입니다.") from inner_exc

        exp_raw = payload.get("exp")
        if not isinstance(exp_raw, (int, float)):
            raise ValueError("유효하지 않은 토큰입니다.")

        now_ts = datetime.now(timezone.utc).timestamp()
        grace_seconds = ACCESS_TOKEN_EXPIRE_GRACE_MINUTES * 60
        if now_ts - float(exp_raw) <= grace_seconds:
            token_type = payload.get("token_type")
            if token_type and token_type != "access":
                raise ValueError("유효하지 않은 토큰입니다.")
            return payload

        raise ValueError("유효하지 않은 토큰입니다.") from exc


def decode_refresh_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
    except JWTError as exc:
        raise ValueError("유효하지 않은 토큰입니다.") from exc

    if payload.get("token_type") != "refresh":
        raise ValueError("유효하지 않은 토큰입니다.")
    return payload
