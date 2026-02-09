import undetected_chromedriver as uc
import platform
import logging
import base64
import hashlib
import json
import tempfile
import subprocess
import re
from pathlib import Path
from luckyx_automation.config import settings
try:
    from capsolver_extension_python import Capsolver
except ImportError:
    Capsolver = None

class DriverFactory:
    @staticmethod
    def _detect_chrome_binary_and_major(logger: logging.Logger) -> tuple:
        configured = (getattr(settings, "CHROME_BINARY", "") or "").strip()
        candidates = [configured]

        if platform.system() == "Darwin":
            candidates.append(
                "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
            )
            pw_base = Path.home() / "Library/Caches/ms-playwright"
            for chromium_dir in sorted(pw_base.glob("chromium-*/chrome-mac*/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"), reverse=True):
                candidates.append(str(chromium_dir))
            for chromium_dir in sorted(pw_base.glob("chromium-*/chrome-mac*/Chromium.app/Contents/MacOS/Chromium"), reverse=True):
                candidates.append(str(chromium_dir))
            candidates.append(
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
            )
        else:
            candidates += [
                "/usr/bin/google-chrome-for-testing",
                "/usr/bin/google-chrome-stable",
                "/usr/bin/google-chrome",
                "/usr/bin/chromium-browser",
                "/usr/bin/chromium",
            ]

        for candidate in candidates:
            if not candidate:
                continue
            path = Path(candidate).expanduser()
            if not path.exists():
                continue
            try:
                proc = subprocess.run(
                    [str(path), "--version"],
                    capture_output=True,
                    text=True,
                    timeout=5,
                    check=False,
                )
                text = f"{proc.stdout}\n{proc.stderr}".strip()
                m = re.search(r"(\d+)\.\d+\.\d+\.\d+", text)
                if m:
                    major = int(m.group(1))
                    logger.info(f"Detected Chrome binary: {path} (major={major})")
                    return str(path), major
            except Exception as e:
                logger.debug(f"Failed to detect Chrome version from {path}: {e}")

        return "", 0

    @staticmethod
    def _extension_id_from_manifest_key(extension_dir, logger: logging.Logger) -> str:
        try:
            manifest_path = extension_dir / "manifest.json"
            if not manifest_path.exists():
                return ""
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            key_b64 = (manifest.get("key") or "").strip()
            if not key_b64:
                return ""
            padded = key_b64 + ("=" * (-len(key_b64) % 4))
            der = base64.b64decode(padded)
            digest = hashlib.sha256(der).hexdigest()[:32]
            return digest.translate(str.maketrans("0123456789abcdef", "abcdefghijklmnop"))
        except Exception as e:
            logger.debug(f"Failed to compute extension id from manifest key: {e}")
            return ""

    @staticmethod
    def discover_extension_id(driver, logger: logging.Logger) -> str:
        """
        Unified method to discover MetaMask extension ID from:
        1. CDP Target.getTargets (most reliable)
        2. chrome://extensions/ (DOM scraping)
        3. Window handles/titles (fallback)
        """
        # 1. CDP Discovery
        try:
            data = driver.execute_cdp_cmd("Target.getTargets", {})
            infos = (data or {}).get("targetInfos") or []
            candidates = []
            for info in infos:
                url = (info.get("url") or "").strip()
                title = (info.get("title") or "").strip().lower()
                if not url.startswith("chrome-extension://"):
                    continue
                rest = url.split("chrome-extension://", 1)[1]
                ext_id = rest.split("/", 1)[0].strip().lower()
                if not ext_id:
                    continue
                score = 0
                if "metamask" in title:
                    score += 6
                if "metamask" in url.lower():
                    score += 3
                candidates.append((score, ext_id, url, title))
            if candidates:
                candidates.sort(key=lambda x: x[0], reverse=True)
                best = candidates[0]
                if best[0] > 0:
                    logger.info(f"Discovered MetaMask extension id (CDP): {best[1]}")
                    return best[1]
        except Exception as e:
            logger.debug(f"CDP discovery failed: {e}")

        # 2. chrome://extensions/ Discovery
        try:
            driver.get("chrome://extensions/")
            candidates = driver.execute_script(
                """
                const out = [];
                const visited = new Set();
                const queue = [document];

                function safeText(el) {
                  try { return (el && (el.innerText || el.textContent) || '').trim(); } catch { return ''; }
                }

                while (queue.length) {
                  const root = queue.shift();
                  if (!root || visited.has(root)) continue;
                  visited.add(root);

                  let items = [];
                  try { items = Array.from(root.querySelectorAll ? root.querySelectorAll('extensions-item') : []); } catch {}
                  for (const item of items) {
                    try {
                      const id = (item.getAttribute('id') || '').trim();
                      const nameEl = item.shadowRoot ? item.shadowRoot.querySelector('#name') : null;
                      const name = safeText(nameEl) || safeText(item);
                      if (id && name) out.push({ id, name });
                    } catch {}
                  }

                  let all = [];
                  try { all = Array.from(root.querySelectorAll ? root.querySelectorAll('*') : []); } catch {}
                  for (const el of all) {
                    try {
                      if (el && el.shadowRoot) queue.push(el.shadowRoot);
                    } catch {}
                  }
                }

                return out;
                """
            )
            for item in (candidates or []):
                name = (item.get("name") or "").strip().lower()
                ext_id = (item.get("id") or "").strip().lower()
                if "metamask" in name and ext_id:
                    logger.info(f"Discovered MetaMask extension id (chrome://extensions): {ext_id}")
                    return ext_id
        except Exception as e:
            logger.debug(f"chrome://extensions discovery failed: {e}")

        # 3. Window Handle Discovery
        original = None
        try:
            original = driver.current_window_handle
        except Exception:
            original = None

        candidates = []
        for handle in list(getattr(driver, "window_handles", []) or []):
            try:
                driver.switch_to.window(handle)
                url = (driver.current_url or "").strip()
                title = (driver.title or "").strip().lower()
                if not url.startswith("chrome-extension://"):
                    continue
                ext_id = url.split("chrome-extension://", 1)[1].split("/", 1)[0].strip().lower()
                if not ext_id:
                    continue
                score = 0
                if "metamask" in title:
                    score += 5
                if "/home.html" in url.lower():
                    score += 3
                if "#onboarding" in url.lower() or "#initialize" in url.lower() or "#unlock" in url.lower():
                    score += 2
                candidates.append((score, ext_id))
            except Exception:
                continue

        if original:
            try:
                driver.switch_to.window(original)
            except Exception:
                pass

        if not candidates:
            return ""

        candidates.sort(key=lambda x: x[0], reverse=True)
        best = candidates[0]
        if best[0] <= 0:
            return ""

        logger.info(f"Discovered MetaMask extension id (Window Handles): {best[1]}")
        return best[1]

    @staticmethod
    def _safe_proxy(proxy: str) -> str:
        if "@" not in proxy:
            return proxy
        try:
            scheme, rest = proxy.split("://", 1)
            creds, host = rest.rsplit("@", 1)
            return f"{scheme}://***:***@{host}"
        except Exception:
            return "***"

    @staticmethod
    def create_driver(logger: logging.Logger, proxy: str = "") -> tuple:
        """
        Creates and returns (driver, extension_id, profile_dir).
        """
        if settings.HEADLESS:
            raise RuntimeError("HEADLESS=true is not supported with MetaMask automation.")

        logger.info("Initializing undetected_chromedriver options...")
        options = uc.ChromeOptions()
        
        if not settings.METAMASK_EXTENSION_PATH.exists():
            logger.error(f"MetaMask extension NOT found at {settings.METAMASK_EXTENSION_PATH}")
            raise FileNotFoundError(f"MetaMask extension not found at {settings.METAMASK_EXTENSION_PATH}")

        extension_paths = [str(settings.METAMASK_EXTENSION_PATH)]
        capsolver_key = (getattr(settings, "CAPSOLVER_API_KEY", "") or "").strip()
        if capsolver_key and Capsolver:
            try:
                capsolver_path = Capsolver(api_key=capsolver_key).load(with_command_line_option=False)
                if capsolver_path:
                    extension_paths.append(capsolver_path)
            except Exception as e:
                logger.warning(f"Failed to load CapSolver extension: {e}")

        options.add_argument(f"--load-extension={','.join(extension_paths)}")
        logger.info(f"Loaded extensions: {len(extension_paths)}")
        
        # Basic Options
        options.add_argument("--no-first-run")
        options.add_argument("--no-service-autorun")
        options.add_argument("--password-store=basic")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--disable-blink-features=AutomationControlled")
        options.add_argument("--lang=en-US")
        options.add_argument("--window-size=1280,900")
        
        if platform.system().lower() == "linux":
            options.add_argument("--no-sandbox")

        options.add_argument("--disable-popup-blocking")

        configured_profile = (getattr(settings, "CHROME_USER_DATA_DIR", "") or "").strip()
        if configured_profile:
            profile_dir = Path(configured_profile).expanduser()
            profile_dir.mkdir(parents=True, exist_ok=True)
        else:
            profile_dir = Path(tempfile.mkdtemp(prefix="luckyx_chrome_"))
        crash_dir = profile_dir / "Crashpad"
        crash_dir.mkdir(parents=True, exist_ok=True)
        options.add_argument(f"--user-data-dir={profile_dir}")
        options.add_argument(f"--crash-dumps-dir={crash_dir}")
        logger.info(f"Using Chrome user data dir: {profile_dir}")
        
        # Proxy Support
        proxy_to_use = (proxy or settings.PROXY or "").strip()
        if proxy_to_use:
            options.add_argument(f'--proxy-server={proxy_to_use}')
            logger.info(f"Using proxy: {DriverFactory._safe_proxy(proxy_to_use)}")
            if "@" in proxy_to_use:
                logger.warning("Proxy URL contains credentials; Chrome proxy auth may not work without an auth extension.")

        logger.info("Starting Browser Process...")
        try:
            chrome_binary, chrome_major = DriverFactory._detect_chrome_binary_and_major(logger)
            if chrome_binary:
                options.binary_location = chrome_binary
                logger.info(f"Using Chrome binary: {chrome_binary}")
            chrome_kwargs = {
                "options": options,
                "headless": settings.HEADLESS,
                "use_subprocess": True,
            }
            if chrome_major > 0:
                chrome_kwargs["version_main"] = chrome_major

            driver = uc.Chrome(
                **chrome_kwargs,
            )
            driver.implicitly_wait(10)
            logger.info("Browser started successfully.")
            
            ext_id = (settings.METAMASK_EXTENSION_ID or "").strip()
            try:
                if not ext_id:
                    from_key = DriverFactory._extension_id_from_manifest_key(settings.METAMASK_EXTENSION_PATH, logger)
                    if from_key:
                        ext_id = from_key
                
                # Try to discover if still empty or verify
                discovered = DriverFactory.discover_extension_id(driver, logger)
                if discovered:
                    ext_id = discovered
                
                if ext_id:
                    mm_urls = [
                        f"chrome-extension://{ext_id}/home.html#onboarding/welcome",
                        f"chrome-extension://{ext_id}/home.html#initialize/welcome",
                        f"chrome-extension://{ext_id}/home.html#unlock",
                        f"chrome-extension://{ext_id}/home.html",
                    ]
                    for url in mm_urls:
                        try:
                            driver.get(url)
                            logger.info("Opened MetaMask extension page.")
                            break
                        except Exception as inner:
                            logger.debug(f"Failed to open MetaMask URL '{url}': {inner}")
            except Exception as e:
                logger.warning(f"Failed to open MetaMask extension page: {e}")
            
            return driver, ext_id, profile_dir
        except Exception as e:
            logger.critical(f"Failed to start browser: {e}")
            raise
