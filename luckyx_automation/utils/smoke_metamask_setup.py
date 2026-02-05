import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from luckyx_automation.config import settings
from luckyx_automation.core.decorators import AccountConfig, TaskContext
from luckyx_automation.core.driver import DriverFactory
from luckyx_automation.core.logger import LoggerSetup, get_run_id
from luckyx_automation.pages.metamask import MetaMaskController


def main() -> int:
    group_id = get_run_id()
    group_dir = settings.LOGS_DIR / f"smoke_{group_id}"
    screenshots_dir = group_dir / "screenshots"
    screenshots_dir.mkdir(parents=True, exist_ok=True)

    logger = LoggerSetup.setup_logger("Smoke", f"smoke_{group_id}", group_dir, debug=False)

    cfg = AccountConfig(
        label="smoke",
        proxy="",
        metamask_password="Passw0rd!123",
        metamask_seed_phrase="test test test test test test test test test test test junk",
        metamask_private_key="",
        email_account="",
        email_password="",
        email_imap_server="",
        invite_code="",
    )

    context = TaskContext(f"smoke_{group_id}", group_dir, screenshots_dir, logger, config=cfg)
    try:
        context.driver = DriverFactory.create_driver(logger, proxy="")
        mm = MetaMaskController(context)
        mm.setup_wallet()
        logger.info(f"MetaMask extension id: {settings.METAMASK_EXTENSION_ID}")
        time.sleep(2)
        return 0
    except Exception as e:
        logger.critical(f"Smoke failed: {e}")
        if context.driver:
            context.capture_screenshot("SMOKE_FAILED")
        return 1
    finally:
        if context.driver:
            try:
                context.driver.quit()
            except Exception:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
