# Engineering Guidelines (LuckyX Automation)

## Scope
This document organizes the working rules and migration notes from `.cursorrules` into a concise internal guide for day‑to‑day development and operations in this repository.

## Environment & Execution
- Prefer `python3` over `python` in zsh to avoid `command not found`.
- For multi‑line or complex shell scripts, write a repo script and run it instead of inline here‑docs.

## Proxy & Networking
- Always mask credentials in logs for proxies like `user:pass@host:port`.
- Normalize proxy strings to include a scheme (e.g., `http://ip:port`) to avoid Chrome parsing issues.
- Use `requests` for proxy pool HTTP calls with explicit timeout and status handling.
- Implement “per‑account sticky proxy + rotate on failure”, with optional custom headers (token).
- For Playwright proxy pool retries, tune `PROXY_POOL_RETRY` and `PROXY_POOL_BACKOFF_MS`.
- For browser launch retry with proxy rotation, tune `PROXY_LAUNCH_RETRIES` and `PROXY_LAUNCH_BACKOFF_MS`.

## MetaMask & Extensions
- Do not hardcode MetaMask extension IDs; discover them at runtime when possible.
- Use `chrome-extension://<id>/home.html` to open the extension; common routes include `#onboarding`, `#initialize`, `#unlock`.
- If a stable ID is required for unpacked extensions, set `key` in `manifest.json`.
- SRP import restores the whole wallet; private key import adds a single account after unlock.
- Use Synpress standard cache flow:
- First run `npm --prefix enterprise_pw run wallet:cache` to build `.cache-synpress/<hash>` from `wallet-setup/generated/*.setup.ts`.
- E2E tests must consume cache only; do not create wallet cache on the fly inside fixtures.

## Automation Stability
- Prefer retry frameworks like `tenacity` for robust, configurable retries.
- Keep per‑account log and screenshot directories to avoid cross‑account confusion.
- Avoid Playwright global state for extension pages in parallel runs; use fixtures per test.
- Start tracing only after unlock to avoid recording sensitive inputs.

## Playwright Migration Path (If/When)
- Target PoC: connect, sign, and confirm transaction flows end‑to‑end.
- Keep account input contract stable: `label/proxy/srp/pk/email/invite_code`.
- Use `launchPersistentContext` with `--load-extension=ext1,ext2` and per‑account userDataDir.
- Preserve proxy strategy and artifacts (trace/video/screenshot/log) per account.
- dAppwright or Synpress are preferred over hand‑rolled XPath flows; dappeteer is deprecated.

## Security & Compliance
- Never log seed phrases, private keys, or email passwords.
- Avoid writing CapSolver API keys into the repo; copy to a temp context then modify.

## Observability & Debugging
- Default to step‑level logging; aggregate failures by phase (connect/sign/tx/page).
- Keep artifacts only on failure to limit disk usage.
