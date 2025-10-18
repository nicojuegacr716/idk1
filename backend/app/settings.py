import re
from functools import lru_cache
from typing import List, Set
from urllib.parse import urlparse

from pydantic import AnyHttpUrl, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    discord_client_id: str = Field(..., alias="DISCORD_CLIENT_ID")
    discord_client_secret: str = Field(..., alias="DISCORD_CLIENT_SECRET")
    discord_redirect_uri: AnyHttpUrl = Field(..., alias="DISCORD_REDIRECT_URI")
    secret_key: str = Field(..., alias="SECRET_KEY")
    database_url: str = Field(..., alias="DATABASE_URL")
    base_url: AnyHttpUrl = Field(..., alias="BASE_URL")
    allowed_origins: str = Field("*", alias="ALLOWED_ORIGINS")
    cookie_secure: bool = Field(False, alias="COOKIE_SECURE")
    session_cookie_name: str = Field("session", alias="SESSION_COOKIE_NAME")
    encryption_key: str = Field(..., alias="ENCRYPTION_KEY")
    openai_api_key: str | None = Field(default=None, alias="OPENAI_API_KEY")
    hface_gpt_base_url: AnyHttpUrl | None = Field(default=None, alias="HFACE_GPT_BASE_URL")
    hface_gpt_model: str = Field("GPT-OSS-120B", alias="HFACE_GPT_MODEL")
    redis_url: str | None = Field(default=None, alias="REDIS_URL")
    feature_flags: str = Field("", alias="FEATURE_FLAGS")
    frontend_redirect_url: str | None = Field(default=None, alias="FRONTEND_REDIRECT_URL")
    canary_percent: int = Field(5, alias="CANARY_PERCENT", ge=0, le=100)

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    @staticmethod
    def _origin_from_url(value: str | AnyHttpUrl | None) -> str | None:
        if not value:
            return None
        try:
            parsed = urlparse(str(value).strip())
        except ValueError:
            return None
        if not parsed.scheme or not parsed.hostname:
            return None
        origin = f"{parsed.scheme}://{parsed.hostname}"
        if parsed.port:
            origin = f"{origin}:{parsed.port}"
        return origin

    @property
    def allowed_origins_list(self) -> List[str]:
        raw = (self.allowed_origins or "").strip()
        if raw == "*":
            return ["*"]

        origins: List[str] = []

        def _add_origin(candidate: str | None) -> None:
            if not candidate or candidate in origins:
                return
            origins.append(candidate)

        if raw:
            for entry in re.split(r"[\s,]+", raw):
                candidate = entry.strip()
                if not candidate:
                    continue
                parsed = self._origin_from_url(candidate)
                _add_origin(parsed or candidate)

        fallback = self._origin_from_url(self.frontend_redirect_url)
        _add_origin(fallback)

        return origins

    @property
    def discord_scopes(self) -> str:
        return "identify email"

    @property
    def feature_flags_list(self) -> List[str]:
        raw = self.feature_flags.strip()
        if not raw:
            return []
        return [flag.strip() for flag in raw.split(",") if flag.strip()]

    @property
    def feature_flags_set(self) -> Set[str]:
        return {flag.lower() for flag in self.feature_flags_list}

    def is_feature_enabled(self, flag: str) -> bool:
        return flag.lower() in self.feature_flags_set

    @property
    def frontend_redirect_target(self) -> str:
        target = (self.frontend_redirect_url or "").strip()
        if not target:
            return "/"
        return target


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
