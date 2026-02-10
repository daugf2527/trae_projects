"""Quick diagnostic: launch Chrome with MetaMask extension, dump page elements."""
import sys, os, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from luckyx_automation.config import settings
from luckyx_automation.core.driver import DriverFactory
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger("diag")

# Force use of system Chrome
os.environ["CHROME_BINARY"] = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

driver, ext_id, profile_dir = DriverFactory.create_driver(logger)
logger.info(f"ext_id={ext_id}")

# Navigate to onboarding
url = f"chrome-extension://{ext_id}/home.html#onboarding/welcome"
driver.get(url)
time.sleep(5)

# Dump current URL and title
logger.info(f"URL: {driver.current_url}")
logger.info(f"Title: {driver.title}")

# Dump all buttons on the page
from selenium.webdriver.common.by import By
buttons = driver.find_elements(By.TAG_NAME, "button")
logger.info(f"Found {len(buttons)} <button> elements:")
for i, btn in enumerate(buttons):
    try:
        txt = btn.text.strip()[:80]
        displayed = btn.is_displayed()
        tag = btn.tag_name
        testid = btn.get_attribute("data-testid") or ""
        logger.info(f"  [{i}] tag={tag} displayed={displayed} data-testid='{testid}' text='{txt}'")
    except Exception as e:
        logger.info(f"  [{i}] ERROR: {e}")

# Also check for <a> and <div> with role=button
for sel in ["a", "div[@role='button']", "*[@role='button']"]:
    els = driver.find_elements(By.XPATH, f"//{sel}")
    if els:
        logger.info(f"Found {len(els)} //{sel} elements:")
        for i, el in enumerate(els[:10]):
            try:
                txt = el.text.strip()[:80]
                displayed = el.is_displayed()
                logger.info(f"  [{i}] displayed={displayed} text='{txt}'")
            except:
                pass

driver.quit()
import shutil
if profile_dir and os.path.isdir(profile_dir):
    shutil.rmtree(profile_dir, ignore_errors=True)
