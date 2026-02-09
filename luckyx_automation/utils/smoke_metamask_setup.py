import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from luckyx_automation.config import settings
from luckyx_automation.core.decorators import AccountConfig, TaskContext, _sanitize_message
from luckyx_automation.core.driver import DriverFactory
from luckyx_automation.core.logger import LoggerSetup, get_run_id
from luckyx_automation.pages.metamask import MetaMaskController


def main() -> int:
    group_id = get_run_id()
    group_dir = settings.LOGS_DIR / f"smoke_{group_id}"
    screenshots_dir = group_dir / "screenshots"
    screenshots_dir.mkdir(parents=True, exist_ok=True)

    logger = LoggerSetup.setup_logger("Smoke", f"smoke_{group_id}", group_dir, debug=False)

    # WARNING: fallback values are well-known test-only mnemonics/passwords.
    # NEVER use them for real funds. Override via SMOKE_METAMASK_PASSWORD / SMOKE_SEED_PHRASE env vars.
    smoke_password = os.getenv("SMOKE_METAMASK_PASSWORD", "Passw0rd!123")
    smoke_seed = os.getenv(
        "SMOKE_SEED_PHRASE",
        "test test test test test test test test test test test junk",
    )

    cfg = AccountConfig(
        label="smoke",
        proxy="",
        metamask_password=smoke_password,
        metamask_seed_phrase=smoke_seed,
        metamask_private_key="",
        email_account="",
        email_password="",
        email_imap_server="",
        invite_code="",
    )

    context = TaskContext(f"smoke_{group_id}", group_dir, screenshots_dir, logger, config=cfg)
    try:
        driver, ext_id, profile_dir = DriverFactory.create_driver(logger, proxy="")
        context.driver = driver
        context.metamask_extension_id = ext_id
        context.chrome_profile_dir = profile_dir
        
        mm = MetaMaskController(context)
        mm.setup_wallet()
        logger.info(f"MetaMask extension id: {ext_id}")
        time.sleep(2)
        return 0
    except Exception as e:
        logger.critical(f"Smoke failed: {_sanitize_message(str(e))}")
        if context.driver:
            context.capture_screenshot("SMOKE_FAILED")
        return 1
    finally:
        if context.driver:
            try:
                context.driver.quit()
            except Exception:
                pass
            profile = getattr(context, 'chrome_profile_dir', None)
            if profile and profile.exists() and str(profile).startswith(str(Path(tempfile.gettempdir()))):
                try:
                    shutil.rmtree(profile, ignore_errors=True)
                except Exception:
                    pass


if __name__ == "__main__":
    raise SystemExit(main())
