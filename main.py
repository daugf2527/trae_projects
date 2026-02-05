import csv
import json
import re
import requests
import time
import traceback
import urllib.parse
from luckyx_automation.core.driver import DriverFactory
from luckyx_automation.core.logger import LoggerSetup, get_run_id
from luckyx_automation.core.decorators import TaskContext, AccountConfig
from luckyx_automation.pages.metamask import MetaMaskController
from luckyx_automation.pages.luckyx_page import LuckyXPage
from luckyx_automation.config import settings

def _sanitize_label(label: str) -> str:
    safe = []
    for ch in (label or "").strip():
        if ch.isalnum() or ch in ("-", "_", "."):
            safe.append(ch)
        else:
            safe.append("_")
    out = "".join(safe).strip("._-")
    return out or "account"

def _compose_proxy(host: str, port: str, scheme: str = "", username: str = "", password: str = "") -> str:
    host = (host or "").strip()
    port = str(port).strip()
    scheme = (scheme or "").strip().lower()
    username = (username or "").strip()
    password = (password or "").strip()
    if not host or not port:
        return ""
    if scheme and not re.match(r"^[a-z][a-z0-9+.-]*$", scheme):
        scheme = ""
    if username and password:
        if scheme:
            return f"{scheme}://{username}:{password}@{host}:{port}"
        return f"http://{username}:{password}@{host}:{port}"
    if scheme:
        return f"{scheme}://{host}:{port}"
    return f"{host}:{port}"

def _canonical_proxy(proxy: str) -> str:
    text = (proxy or "").strip().strip('"').strip("'")
    if not text:
        return ""
    if not re.match(r"^[a-z][a-z0-9+.-]*://", text, flags=re.IGNORECASE):
        text = f"http://{text}"
    try:
        parsed = urllib.parse.urlsplit(text)
        if parsed.hostname and parsed.port:
            return text
    except Exception:
        return ""
    return ""

def _extract_proxy_from_text(raw: str) -> str:
    text = (raw or "").strip().strip('"').strip("'")
    if not text:
        return ""

    lines = [ln.strip() for ln in re.split(r"[\r\n]+", text) if ln and ln.strip()]
    if lines:
        text = lines[0]

    m = re.search(r"\b(socks5|socks4|http|https)://[^\s,;|]+", text, flags=re.IGNORECASE)
    if m:
        return m.group(0).strip()

    m = re.search(
        r"\b([A-Za-z0-9._%-]+):([^\s@,;|]+)@((?:\d{1,3}\.){3}\d{1,3}):(\d{2,5})\b",
        text,
    )
    if m:
        return f"http://{m.group(1)}:{m.group(2)}@{m.group(3)}:{m.group(4)}"

    m = re.search(r"\b((?:\d{1,3}\.){3}\d{1,3}):(\d{2,5})\b", text)
    if m:
        return f"{m.group(1)}:{m.group(2)}"

    m = re.search(r"\b([A-Za-z0-9.-]+\.[A-Za-z]{2,}):(\d{2,5})\b", text)
    if m:
        return f"{m.group(1)}:{m.group(2)}"

    parts = re.split(r"[|,;\s]+", text)
    parts = [p.strip() for p in parts if p and p.strip()]
    if len(parts) >= 3 and re.match(r"^(\d{1,3}\.){3}\d{1,3}:\d{2,5}$", parts[0]):
        host, port = parts[0].split(":", 1)
        if len(parts) >= 3:
            return _compose_proxy(host, port, username=parts[1], password=parts[2])

    m = re.search(r"\b((?:\d{1,3}\.){3}\d{1,3}):(\d{2,5}):([^\s:]+):([^\s]+)\b", text)
    if m:
        return _compose_proxy(m.group(1), m.group(2), username=m.group(3), password=m.group(4))

    if "=" in text and "&" in text:
        parsed = urllib.parse.parse_qs(text, keep_blank_values=True)
        ip = (parsed.get("ip") or parsed.get("host") or parsed.get("addr") or [""])[0]
        port = (parsed.get("port") or [""])[0]
        user = (parsed.get("user") or parsed.get("username") or [""])[0]
        pwd = (parsed.get("pass") or parsed.get("password") or parsed.get("pwd") or [""])[0]
        scheme = (parsed.get("protocol") or parsed.get("type") or parsed.get("scheme") or [""])[0]
        proxy = _compose_proxy(ip, port, scheme=scheme, username=user, password=pwd)
        if proxy:
            return proxy

    return text

def _extract_proxy_from_json(obj) -> str:
    if obj is None:
        return ""
    if isinstance(obj, str):
        return _extract_proxy_from_text(obj)
    if isinstance(obj, (int, float, bool)):
        return ""
    if isinstance(obj, list):
        for item in obj:
            proxy = _extract_proxy_from_json(item)
            if proxy:
                return proxy
        return ""
    if isinstance(obj, dict):
        for key in ("proxy", "url", "result", "data", "http", "https", "socks5", "socks4"):
            val = obj.get(key)
            if isinstance(val, str) and val.strip():
                proxy = _extract_proxy_from_text(val)
                if proxy:
                    return proxy

        host = (
            obj.get("ip")
            or obj.get("host")
            or obj.get("server")
            or obj.get("addr")
            or obj.get("address")
            or obj.get("proxy_ip")
        )
        port = obj.get("port") or obj.get("proxy_port")
        if host and port:
            scheme = obj.get("protocol") or obj.get("type") or obj.get("scheme") or obj.get("proto") or ""
            user = obj.get("user") or obj.get("username") or obj.get("account") or obj.get("uname") or ""
            pwd = obj.get("pass") or obj.get("password") or obj.get("pwd") or ""
            auth = obj.get("auth") or obj.get("credentials") or ""
            if isinstance(auth, str) and auth and (not user and not pwd) and ":" in auth:
                user, pwd = auth.split(":", 1)
            proxy = _compose_proxy(str(host), str(port), scheme=str(scheme), username=str(user), password=str(pwd))
            if proxy:
                return proxy

        for v in obj.values():
            proxy = _extract_proxy_from_json(v)
            if proxy:
                return proxy
        return ""
    return ""

def _fetch_proxy_from_pool(logger) -> str:
    url = (settings.PROXY_POOL_URL or "").strip()
    if not url:
        return ""
    headers = {}
    if settings.PROXY_POOL_HEADERS_JSON.strip():
        try:
            parsed = json.loads(settings.PROXY_POOL_HEADERS_JSON)
            if isinstance(parsed, dict):
                for k, v in parsed.items():
                    if k and v is not None:
                        headers[str(k)] = str(v)
        except Exception as e:
            logger.warning(f"Invalid PROXY_POOL_HEADERS_JSON: {e}")
    try:
        resp = requests.get(url, headers=headers or None, timeout=settings.PROXY_POOL_TIMEOUT)
    except Exception as e:
        raise RuntimeError(f"Proxy pool request failed: {e}") from e
    if resp.status_code >= 400:
        raise RuntimeError(f"Proxy pool API HTTP {resp.status_code}.")
    raw = (resp.text or "").strip()
    if not raw:
        raise RuntimeError("Proxy pool API returned empty response.")
    try:
        data = resp.json()
        proxy = _canonical_proxy(_extract_proxy_from_json(data))
        if proxy:
            return proxy
    except Exception:
        pass
    try:
        data = json.loads(raw)
        proxy = _canonical_proxy(_extract_proxy_from_json(data))
        if proxy:
            return proxy
    except Exception:
        pass
    proxy = _canonical_proxy(_extract_proxy_from_text(raw))
    if not proxy:
        raise RuntimeError("Proxy pool API returned empty proxy after parsing.")
    return proxy

def _load_accounts(logger):
    accounts = []
    if settings.ACCOUNTS_JSON.strip():
        parsed = json.loads(settings.ACCOUNTS_JSON)
        if isinstance(parsed, dict):
            parsed = [parsed]
        if not isinstance(parsed, list):
            raise ValueError("ACCOUNTS_JSON must be a JSON object or array.")
        for i, item in enumerate(parsed):
            if not isinstance(item, dict):
                continue
            accounts.append(
                AccountConfig(
                    label=str(item.get("label") or f"acc{i+1}"),
                    proxy=str(item.get("proxy") or ""),
                    metamask_password=str(item.get("metamask_password") or ""),
                    metamask_seed_phrase=str(item.get("metamask_seed_phrase") or ""),
                    metamask_private_key=str(item.get("metamask_private_key") or ""),
                    email_account=str(item.get("email_account") or ""),
                    email_password=str(item.get("email_password") or ""),
                    email_imap_server=str(item.get("email_imap_server") or ""),
                    invite_code=str(item.get("invite_code") or ""),
                )
            )
        return accounts

    accounts_file = (settings.ACCOUNTS_FILE or "").strip()
    if accounts_file:
        with open(accounts_file, "r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            for i, row in enumerate(reader):
                if not row:
                    continue
                accounts.append(
                    AccountConfig(
                        label=str(row.get("label") or f"acc{i+1}"),
                        proxy=str(row.get("proxy") or ""),
                        metamask_password=str(row.get("metamask_password") or ""),
                        metamask_seed_phrase=str(row.get("metamask_seed_phrase") or ""),
                        metamask_private_key=str(row.get("metamask_private_key") or ""),
                        email_account=str(row.get("email_account") or ""),
                        email_password=str(row.get("email_password") or ""),
                        email_imap_server=str(row.get("email_imap_server") or ""),
                        invite_code=str(row.get("invite_code") or ""),
                    )
                )
        return accounts

    accounts.append(
        AccountConfig(
            label="env",
            proxy=settings.PROXY,
            metamask_password=settings.METAMASK_PASSWORD,
            metamask_seed_phrase=settings.METAMASK_SEED_PHRASE,
            metamask_private_key=settings.METAMASK_PRIVATE_KEY,
            email_account=settings.EMAIL_ACCOUNT,
            email_password=settings.EMAIL_PASSWORD,
            email_imap_server=settings.EMAIL_IMAP_SERVER,
            invite_code=settings.INVITE_CODE,
        )
    )
    return accounts

def _resolve_proxy(logger, cfg: AccountConfig) -> str:
    proxy = (cfg.proxy or "").strip()
    if settings.PROXY_POOL_URL.strip() and (settings.PROXY_POOL_FORCE or not proxy):
        try:
            proxy = _fetch_proxy_from_pool(logger)
            logger.info("Fetched proxy from pool API.")
        except Exception as e:
            logger.warning(f"Failed to fetch proxy from pool API: {e}")
    if proxy:
        canonical = _canonical_proxy(proxy)
        if canonical:
            return canonical
        logger.warning("Proxy format looks invalid; ignoring this proxy.")
        if settings.PROXY_POOL_FORCE:
            raise RuntimeError("Proxy is required but invalid.")
    return ""

def _run_one_account(group_dir, group_id, index: int, cfg: AccountConfig):
    label = _sanitize_label(cfg.label)
    run_id = f"{index:03d}_{label}"
    log_dir = group_dir / run_id
    screenshots_dir = log_dir / "screenshots"
    screenshots_dir.mkdir(parents=True, exist_ok=True)

    logger = LoggerSetup.setup_logger(f"Run{index:03d}", run_id, log_dir)
    logger.info(f"=== Starting Account Run {index:03d}: {cfg.label} (Group {group_id}) ===")

    if not cfg.metamask_password.strip():
        raise RuntimeError("metamask_password is empty.")
    if not (cfg.metamask_seed_phrase.strip() or cfg.metamask_private_key.strip()):
        raise RuntimeError("both metamask_seed_phrase and metamask_private_key are empty.")

    context = TaskContext(run_id, log_dir, screenshots_dir, logger, config=cfg)
    try:
        proxy = _resolve_proxy(logger, cfg)
        context.driver = DriverFactory.create_driver(logger, proxy=proxy)

        mm = MetaMaskController(context)
        mm.setup_wallet()

        lucky = LuckyXPage(context)
        lucky.open()
        lucky.connect_wallet()
        lucky.daily_checkin()

        if cfg.email_account and cfg.email_password:
            lucky.bind_email()
        else:
            logger.info("Skipping Email Binding (Credentials not set)")

        lucky.handle_invites()
        logger.info("=== Account Run Completed Successfully ===")
        time.sleep(2)
    except Exception as e:
        logger.critical(f"Unhandled Exception: {e}")
        logger.debug(traceback.format_exc())
        if context.driver:
            context.capture_screenshot("CRITICAL_FAILURE")
        raise
    finally:
        if context.driver:
            logger.info("Closing browser...")
            try:
                context.driver.quit()
            except Exception:
                pass

def main():
    group_id = get_run_id()
    group_dir = settings.LOGS_DIR / group_id
    group_dir.mkdir(parents=True, exist_ok=True)
    logger = LoggerSetup.setup_logger("Main", group_id, group_dir)
    logger.info(f"=== Starting Batch Run: {group_id} ===")

    if not settings.METAMASK_EXTENSION_PATH.exists() or not (settings.METAMASK_EXTENSION_PATH / "manifest.json").exists():
        logger.critical(f"MetaMask extension not found at {settings.METAMASK_EXTENSION_PATH}")
        return
    accounts = _load_accounts(logger)
    if not accounts:
        logger.critical("No accounts loaded.")
        return

    failures = 0
    for idx, cfg in enumerate(accounts, start=1):
        try:
            _run_one_account(group_dir, group_id, idx, cfg)
        except Exception:
            failures += 1
            continue

    logger.info(f"=== Batch Run Finished: total={len(accounts)} failures={failures} ===")

if __name__ == "__main__":
    main()
