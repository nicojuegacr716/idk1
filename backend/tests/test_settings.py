from __future__ import annotations

from app.settings import Settings


def build_settings(monkeypatch, **overrides) -> Settings:
    base_env = {
        "DISCORD_CLIENT_ID": "test-client",
        "DISCORD_CLIENT_SECRET": "test-secret",
        "DISCORD_REDIRECT_URI": "https://example.com/auth",
        "SECRET_KEY": "x" * 64,
        "DATABASE_URL": "postgresql+psycopg://user:pass@db:5432/app",
        "BASE_URL": "https://api.example.com",
        "ALLOWED_ORIGINS": "",
        "COOKIE_SECURE": "false",
        "SESSION_COOKIE_NAME": "session",
        "ENCRYPTION_KEY": "y" * 44,
        "OPENAI_API_KEY": "",
        "HFACE_GPT_BASE_URL": "https://router.huggingface.co/v1",
        "HFACE_GPT_MODEL": "openai/gpt-oss-120b",
        "REDIS_URL": "",
        "FEATURE_FLAGS": "",
        "CANARY_PERCENT": "5",
        "FRONTEND_REDIRECT_URL": "https://front.example.com/dashboard",
    }
    base_env.update(overrides)

    for key, value in base_env.items():
        if value is None:
            monkeypatch.delenv(key, raising=False)
        else:
            monkeypatch.setenv(key, str(value))

    return Settings()


def test_allowed_origins_uses_frontend_redirect_when_blank(monkeypatch):
    settings = build_settings(
        monkeypatch,
        ALLOWED_ORIGINS="",
        FRONTEND_REDIRECT_URL="https://dash.lt4c.io.vn/dashboard",
    )
    assert settings.allowed_origins_list == ["https://dash.lt4c.io.vn"]


def test_allowed_origins_parses_whitespace_and_commas(monkeypatch):
    settings = build_settings(
        monkeypatch,
        ALLOWED_ORIGINS="https://dash.lt4c.io.vn\nhttps://admin.lt4c.io.vn  https://foo.com",
        FRONTEND_REDIRECT_URL="https://dash.lt4c.io.vn/dashboard",
    )
    assert settings.allowed_origins_list == [
        "https://dash.lt4c.io.vn",
        "https://admin.lt4c.io.vn",
        "https://foo.com",
    ]


def test_allowed_origins_retains_wildcard(monkeypatch):
    settings = build_settings(
        monkeypatch,
        ALLOWED_ORIGINS="*",
        FRONTEND_REDIRECT_URL="https://dash.lt4c.io.vn/dashboard",
    )
    assert settings.allowed_origins_list == ["*"]


def test_allowed_origins_normalises_url_path(monkeypatch):
    settings = build_settings(
        monkeypatch,
        ALLOWED_ORIGINS="https://dash.lt4c.io.vn/dashboard",
        FRONTEND_REDIRECT_URL="https://other.example.com/home",
    )
    assert settings.allowed_origins_list == ["https://dash.lt4c.io.vn", "https://other.example.com"]
