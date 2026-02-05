# Repository Guidelines
#永远用中文和我对话
## Project Structure & Module Organization
This repository contains a Python automation script for the LuckyX web app.
- `main.py`: Batch entry point for running one or more accounts.
- `luckyx_automation/`: Core package.
- `luckyx_automation/pages/`: Page objects and flows (LuckyX + MetaMask).
- `luckyx_automation/core/`: Driver factory, logging, decorators, context.
- `luckyx_automation/utils/`: Helpers (email, MetaMask setup, smoke).
- `luckyx_automation/assets/`: Browser extensions (expects `metamask-extension/`).
- `luckyx_automation/logs/`: Run logs and screenshots (generated).
There are no dedicated tests or `tests/` directory at the moment.

## Build, Test, and Development Commands
- `pip install -r luckyx_automation/requirements.txt`
  Installs runtime dependencies.
- `python main.py`
  Runs the batch automation flow (requires `.env` and MetaMask extension).
- `python luckyx_automation/utils/smoke_metamask_setup.py`
  Minimal smoke check to validate MetaMask setup.
- `python luckyx_automation/utils/metamask_extension_setup.py`
  Downloads and extracts the MetaMask extension into `luckyx_automation/assets/`.

## Coding Style & Naming Conventions
- Python, 4-space indentation, PEP 8 style.
- Modules and functions use `snake_case`; classes use `PascalCase`.
- Keep selectors centralized in page objects (`luckyx_automation/pages/`).
- No formatter or linter is configured; avoid introducing one without team agreement.

## Testing Guidelines
No automated test suite is present. Use the smoke script above for quick validation.
If you add tests, prefer a `tests/` folder and name tests `test_*.py`.

## Commit & Pull Request Guidelines
This workspace is not a Git repository, so no commit history is available.
If you initialize Git, use short, imperative commit messages (e.g., `Add proxy pool parsing`).
For PRs, include a concise description, repro steps, and any screenshots of flows that
changed (e.g., MetaMask or LuckyX UI).

## Security & Configuration Tips
- Secrets live in `.env` (copy from `luckyx_automation/.env.example`); never commit it.
- Do not log seed phrases, private keys, or email passwords.
- `HEADLESS=true` is not supported with MetaMask automation.
