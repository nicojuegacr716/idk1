# Backend CI/CD Pipeline

This repository now includes an end-to-end GitHub Actions workflow that validates every push to `main` and automatically deploys the backend over SSH using the existing `docker-compose.yml`. The pipeline keeps the production `.env` file untouched so the server can maintain environment-specific configuration.

## Workflow overview
- **Trigger:** every push to `main` (and manual runs via *Run workflow*).
- **Test job:** checks out the code, installs Python `3.11`, restores cached dependencies, installs the project with the `dev` extras, primes required env vars (such as `ENCRYPTION_KEY`), runs `pytest`, and then executes the Vite build for the embedded frontend.
- **Deploy job:** (only runs if tests pass and all deployment secrets exist) validates the Docker build, archives the repository while excluding `.env` files, uploads the archive to the remote host, and rebuilds/restarts the Compose stack with `docker compose up -d --build --remove-orphans`.
- **Error handling:** any failure in the SSH/deploy step surfaces in the GitHub Actions logs so problems are visible directly in the PR or push status.

## Required GitHub secrets
Add the following repository secrets before expecting automatic deployments:

| Secret | Description |
| ------ | ----------- |
| `SSH_HOST` | Public hostname or IP address of the deployment server. |
| `SSH_USER` | SSH user account that owns the deployment directory and can run Docker. |
| `SSH_KEY` | Private SSH key (PEM format, no passphrase) that matches an authorized key for `SSH_USER`. |
| `SSH_PORT` *(optional)* | SSH port if the server does not use `22`. |
| `DEPLOY_PATH` | Absolute path on the server where the backend should live (for example `/opt/lt4c/backend`). |

All secrets are consumed only within the deploy job. If any are missing the deploy job is skipped, but tests still run.

## Remote server preparation
1. Install Docker Engine, the Docker Compose plugin (or legacy `docker-compose`), `tar`, and preferably `rsync`.
2. Create the deployment directory declared in `DEPLOY_PATH`, for example:
   ```bash
   sudo mkdir -p /opt/lt4c/backend/current
   sudo chown -R $USER:$USER /opt/lt4c/backend
   ```
3. Copy the production `.env` file into `/opt/lt4c/backend/current/.env`. This file is never overwritten by the workflow.
4. Ensure the deployment user belongs to the `docker` group (or otherwise has permission to run Docker commands without `sudo`).

The first successful workflow run will populate `/opt/lt4c/backend/current` with the latest application code and `docker-compose.yml`. Subsequent runs will update the directory in-place while keeping `.env` untouched.

## Manual operations
- **Trigger redeploy:** use the *Run workflow* button in GitHub Actions to redeploy the current `main` revision.
- **Check service status:** run `docker compose ps` (or `docker-compose ps`) inside `DEPLOY_PATH/current` on the server.
- **Roll back quickly:** copy a previous archive into `DEPLOY_PATH/releases`, extract it manually, and rerun the deploy command block from the workflow logs.

## Notes
- Local development continues to rely on the repository `.env`. The workflow explicitly excludes every `.env` file from the deployment archive so production secrets stay remote.
- If you later add background workers or extra services, extend `docker-compose.yml` as usual; the pipeline already rebuilds and restarts the entire Compose project.
- The GitHub Actions workflow lives at the repository root (`.github/workflows/backend-ci-cd.yml`) and explicitly works from the `backend/` subdirectory when building, testing, packaging, and running the Vite build for the embedded frontend. If any deployment secrets are missing the deploy job skips automatically and prints a reminder in the workflow logs.
- The workflow adds concurrency protection (`backend-refs/heads/main`) so only one deployment runs at a time, preventing overlapping releases.
