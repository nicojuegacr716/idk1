#!/usr/bin/env python3
"""Test script to verify backend imports work correctly."""

import os

print(f"Current directory: {os.getcwd()}")
print(f".env file exists: {os.path.exists('.env')}")

if os.path.exists('.env'):
    print("Environment variables from .env:")
    with open('.env', 'r') as f:
        for line in f:
            if '=' in line and not line.strip().startswith('#'):
                key, value = line.strip().split('=', 1)
                print(f"  {key}={value}")

try:
    from app.settings import get_settings
    settings = get_settings()
    print("✅ Settings loaded successfully")
    print(f"  Base URL: {settings.base_url}")
    print(f"  Database URL: {settings.database_url}")

    from app.api.vps import router
    print("✅ app.api.vps import successful")

    from app.services.vps import VpsService
    print("✅ app.services.vps import successful")

    from app.services.worker_client import WorkerClient
    print("✅ app.services.worker_client import successful")

    from app.services.worker_selector import WorkerSelector
    print("✅ app.services.worker_selector import successful")

    print("\n🎉 All backend imports successful! The VPS creation fixes are working.")

except ImportError as e:
    print(f"❌ Import error: {e}")
    print("Please run: pip install -e .")
except Exception as e:
    print(f"❌ Unexpected error: {e}")
