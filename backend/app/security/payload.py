from __future__ import annotations

import base64
import json
import secrets
from hashlib import sha256
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def _derive_key(secret: str) -> bytes:
    """Derive a 256-bit AES key from the provided secret string."""
    return sha256(secret.encode("utf-8")).digest()


def _encode_segment(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii")


def _decode_segment(value: str) -> bytes:
    return base64.urlsafe_b64decode(value.encode("ascii"))


def encrypt_payload(data: Any, secret: str) -> str:
    """Encrypt a JSON-serialisable payload with AES-GCM.

    The return format is `<iv>.<ciphertext>` using url-safe base64 segments.
    """
    key = _derive_key(secret)
    aesgcm = AESGCM(key)
    iv = secrets.token_bytes(12)
    plaintext = json.dumps(data, separators=(",", ":")).encode("utf-8")
    ciphertext = aesgcm.encrypt(iv, plaintext, None)
    return f"{_encode_segment(iv)}.{_encode_segment(ciphertext)}"


def decrypt_payload(token: str, secret: str) -> Any:
    """Decrypt a previously encrypted payload.

    Raises ValueError when the token cannot be decoded or verified.
    """
    if "." not in token:
        raise ValueError("Malformed encrypted payload.")
    iv_segment, cipher_segment = token.split(".", 1)
    key = _derive_key(secret)
    aesgcm = AESGCM(key)
    try:
        plaintext = aesgcm.decrypt(_decode_segment(iv_segment), _decode_segment(cipher_segment), None)
    except Exception as exc:  # pragma: no cover - defensive
        raise ValueError("Unable to decrypt payload.") from exc
    try:
        return json.loads(plaintext.decode("utf-8"))
    except json.JSONDecodeError as exc:  # pragma: no cover - defensive
        raise ValueError("Decrypted payload is not valid JSON.") from exc
