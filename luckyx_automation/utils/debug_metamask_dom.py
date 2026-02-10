"""Debug script: opens MetaMask and uses CDP to inspect DOM (bypasses LavaMoat)."""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from luckyx_automation.config import settings
from luckyx_automation.core.driver import DriverFactory
from luckyx_automation.core.logger import LoggerSetup, get_run_id


def cdp_eval(driver, expression):
    """Execute JS via CDP Runtime.evaluate to bypass LavaMoat scuttling."""
    result = driver.execute_cdp_cmd("Runtime.evaluate", {
        "expression": expression,
        "returnByValue": True,
    })
    return result.get("result", {}).get("value")


def main():
    group_id = get_run_id()
    group_dir = settings.LOGS_DIR / f"debug_{group_id}"
    group_dir.mkdir(parents=True, exist_ok=True)
    logger = LoggerSetup.setup_logger("Debug", f"debug_{group_id}", group_dir, debug=True)

    driver = None
    try:
        driver, ext_id, profile_dir = DriverFactory.create_driver(logger, proxy="")
        logger.info(f"Extension ID: {ext_id}")

        base_url = f"chrome-extension://{ext_id}/home.html#onboarding/welcome"
        driver.get(base_url)
        logger.info(f"Navigated to: {base_url}")
        time.sleep(5)

        logger.info(f"Current URL: {driver.current_url}")
        logger.info(f"Current title: {driver.title}")

        # Use CDP to enumerate buttons
        js_buttons = """
        (function() {
            var btns = document.querySelectorAll('button');
            var result = [];
            for (var i = 0; i < btns.length; i++) {
                result.push({
                    index: i,
                    text: btns[i].textContent.trim().substring(0, 80),
                    visible: btns[i].offsetParent !== null,
                    testid: btns[i].getAttribute('data-testid') || '',
                    tag: btns[i].tagName
                });
            }
            return JSON.stringify(result);
        })()
        """
        buttons_json = cdp_eval(driver, js_buttons)
        logger.info(f"Buttons via CDP: {buttons_json}")

        # Click "我已有一个钱包"
        cdp_eval(driver, """document.querySelector('[data-testid="onboarding-import-wallet"]').click()""")
        time.sleep(2)
        logger.info(f"After import click URL: {driver.current_url}")

        # Click "使用私钥助记词导入"
        cdp_eval(driver, """(function(){ var el = document.querySelector('[data-testid="onboarding-import-with-srp-button"]'); if(el) el.click(); return el ? 'clicked' : 'not found'; })()""")
        time.sleep(2)

        # Check for metametrics
        buttons_json2 = cdp_eval(driver, js_buttons)
        logger.info(f"Buttons after SRP choice: {buttons_json2}")

        # Try agree
        cdp_eval(driver, """(function(){ var el = document.querySelector('[data-testid="metametrics-i-agree"]') || document.querySelector('[data-testid="metametrics-no-thanks"]'); if(el) el.click(); return el ? 'clicked' : 'not found'; })()""")
        time.sleep(2)

        # Now check for textarea
        ta_check = cdp_eval(driver, """(function(){ var ta = document.querySelectorAll('textarea'); return 'textareas: ' + ta.length + ', first visible: ' + (ta.length > 0 ? (ta[0].offsetParent !== null) : 'N/A'); })()""")
        logger.info(f"Textarea check: {ta_check}")

        # Try to fill textarea using different methods
        test_srp = "test test test test test test test test test test test junk"

        # Method 1: nativeInputValueSetter
        r1 = cdp_eval(driver, f"""
        (function() {{
            var ta = document.querySelector('textarea');
            if (!ta) return 'no textarea';
            var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
            if (nativeSetter && nativeSetter.set) {{
                nativeSetter.set.call(ta, '{test_srp}');
                ta.dispatchEvent(new Event('input', {{ bubbles: true }}));
                return 'method1: filled, value=' + ta.value.substring(0, 20);
            }}
            return 'method1: no native setter';
        }})()
        """)
        logger.info(f"Fill method 1: {r1}")

        # Method 2: direct assignment
        r2 = cdp_eval(driver, f"""
        (function() {{
            var ta = document.querySelector('textarea');
            if (!ta) return 'no textarea';
            ta.value = '{test_srp}';
            ta.dispatchEvent(new Event('input', {{ bubbles: true }}));
            ta.dispatchEvent(new Event('change', {{ bubbles: true }}));
            return 'method2: value=' + ta.value.substring(0, 20);
        }})()
        """)
        logger.info(f"Fill method 2: {r2}")

        # Method 3: focus + execCommand
        r3 = cdp_eval(driver, f"""
        (function() {{
            var ta = document.querySelector('textarea');
            if (!ta) return 'no textarea';
            ta.focus();
            ta.select();
            document.execCommand('insertText', false, '{test_srp}');
            return 'method3: value=' + ta.value.substring(0, 20);
        }})()
        """)
        logger.info(f"Fill method 3: {r3}")

        # Method 4: KeyboardEvent simulation
        r4 = cdp_eval(driver, """
        (function() {
            var ta = document.querySelector('textarea');
            if (!ta) return 'no textarea';
            return 'textarea found, current value length=' + ta.value.length;
        })()
        """)
        logger.info(f"Final state: {r4}")

        buttons_json3 = cdp_eval(driver, js_buttons)
        logger.info(f"Buttons on SRP page: {buttons_json3}")

    except Exception as e:
        logger.critical(f"Debug failed: {e}")
        import traceback
        traceback.print_exc()
    finally:
        if driver:
            try:
                driver.quit()
            except Exception:
                pass

if __name__ == "__main__":
    main()
