import json as _json
import time
import re
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from luckyx_automation.config import settings
from luckyx_automation.core.decorators import TaskContext, robust_step, _sanitize_message

ALLOWED_SRP_WORD_COUNTS = (12, 15, 18, 21, 24)
SRP_WORD_PATTERN = re.compile(r"\w+", flags=re.UNICODE)


class MetaMaskController:
    def __init__(self, context: TaskContext):
        self.context = context
        self.driver = context.driver
        self.wait = WebDriverWait(self.driver, 20)
        self.logger = context.logger

    # ---- CDP helpers (bypass LavaMoat scuttling) ----

    def _cdp_eval(self, expression):
        """Execute JS via CDP Runtime.evaluate to bypass LavaMoat scuttling."""
        try:
            result = self.driver.execute_cdp_cmd("Runtime.evaluate", {
                "expression": expression,
                "returnByValue": True,
            })
            return result.get("result", {}).get("value")
        except Exception as e:
            self.logger.debug(f"CDP eval failed: {e}")
            return None

    def _cdp_click_text(self, keywords, timeout=5):
        """Try to click a button by text using CDP."""
        end = time.time() + timeout
        js_code = """
        (function(keywords) {
            var btns = document.querySelectorAll('button');
            for (var i = 0; i < btns.length; i++) {
                var t = btns[i].textContent.trim();
                for (var j = 0; j < keywords.length; j++) {
                    if (t.indexOf(keywords[j]) !== -1) {
                        btns[i].click();
                        return true;
                    }
                }
            }
            return false;
        })
        """
        # Prepare keyword array string for JS
        kw_json = _json.dumps(keywords)
        
        while time.time() < end:
            res = self._cdp_eval(f"({js_code})({kw_json})")
            if res:
                return True
            time.sleep(0.5)
        return False

    def _cdp_click_testid(self, testids, timeout=5):
        """Try to click a button by data-testid using CDP."""
        end = time.time() + timeout
        js_code = """
        (function(testids) {
            for (var i = 0; i < testids.length; i++) {
                var btn = document.querySelector('button[data-testid="' + testids[i] + '"]');
                if (btn) {
                    btn.click();
                    return true;
                }
            }
            return false;
        })
        """
        id_json = _json.dumps(testids)
        
        while time.time() < end:
            res = self._cdp_eval(f"({js_code})({id_json})")
            if res:
                return True
            time.sleep(0.5)
        return False

    def _cdp_click_first_available(self, testids=None, texts=None, timeout=5):
        """Try to click any button matching the provided testids or texts via CDP."""
        end = time.time() + timeout
        testids = testids or []
        texts = texts or []
        
        while time.time() < end:
            if testids and self._cdp_click_testid(testids, timeout=0.1):
                return True
            if texts and self._cdp_click_text(texts, timeout=0.1):
                return True
            time.sleep(0.5)
        return False

    def _cdp_click_by_text(self, texts, tag="button"):
        """Click the first element matching any of the given text strings via CDP."""
        texts_js = _json.dumps(texts)
        js = f"""
        (function() {{
            var texts = {texts_js};
            var els = document.querySelectorAll('{tag}');
            for (var i = 0; i < els.length; i++) {{
                var t = els[i].textContent.trim();
                for (var j = 0; j < texts.length; j++) {{
                    if (t.indexOf(texts[j]) !== -1) {{
                        els[i].click();
                        return 'clicked: ' + t;
                    }}
                }}
            }}
            return '';
        }})()
        """
        return self._cdp_eval(js) or ""

    def _cdp_click_by_testid(self, testid):
        """Click an element by data-testid attribute via CDP."""
        js = f"""
        (function() {{
            var el = document.querySelector('[data-testid="{testid}"]');
            if (el) {{ el.click(); return 'clicked'; }}
            return '';
        }})()
        """
        return self._cdp_eval(js) or ""

    def _cdp_find_and_fill(self, selector, value):
        """Find an input by CSS selector and set its value via CDP."""
        value_js = _json.dumps(value)
        js = f"""
        (function() {{
            var el = document.querySelector('{selector}');
            if (!el) return '';
            el.focus();
            el.value = {value_js};
            el.dispatchEvent(new Event('input', {{ bubbles: true }}));
            el.dispatchEvent(new Event('change', {{ bubbles: true }}));
            return 'filled';
        }})()
        """
        return self._cdp_eval(js) or ""

    def _cdp_get_buttons_info(self):
        """Get info about all visible buttons via CDP."""
        js = """
        (function() {
            var btns = document.querySelectorAll('button');
            var result = [];
            for (var i = 0; i < btns.length; i++) {
                if (btns[i].offsetParent !== null) {
                    result.push({
                        text: btns[i].textContent.trim().substring(0, 80),
                        testid: btns[i].getAttribute('data-testid') || ''
                    });
                }
            }
            return JSON.stringify(result);
        })()
        """
        raw = self._cdp_eval(js)
        if raw:
            try:
                return _json.loads(raw)
            except Exception:
                pass
        return []

    def _cdp_fill_password_fields(self, password):
        """Fill all visible password input fields via CDP."""
        pw_js = _json.dumps(password)
        js = f"""
        (function() {{
            var inputs = document.querySelectorAll('input[type="password"]');
            var filled = 0;
            for (var i = 0; i < inputs.length; i++) {{
                if (inputs[i].offsetParent !== null) {{
                    inputs[i].focus();
                    inputs[i].value = {pw_js};
                    inputs[i].dispatchEvent(new Event('input', {{ bubbles: true }}));
                    inputs[i].dispatchEvent(new Event('change', {{ bubbles: true }}));
                    filled++;
                }}
            }}
            return filled;
        }})()
        """
        return self._cdp_eval(js) or 0

    def _cdp_check_all_checkboxes(self):
        """Click all unchecked visible checkboxes via CDP."""
        js = """
        (function() {
            var cbs = document.querySelectorAll('input[type="checkbox"]');
            var clicked = 0;
            for (var i = 0; i < cbs.length; i++) {
                if (cbs[i].offsetParent !== null && !cbs[i].checked) {
                    cbs[i].click();
                    clicked++;
                }
            }
            return clicked;
        })()
        """
        return self._cdp_eval(js) or 0

    def _cdp_fill_srp_textarea(self, srp):
        """Fill seed phrase into textarea via CDP."""
        srp_js = _json.dumps(srp)
        js = f"""
        (function() {{
            var ta = document.querySelector('textarea');
            if (!ta) return '';
            ta.focus();
            ta.value = {srp_js};
            ta.dispatchEvent(new Event('input', {{ bubbles: true }}));
            ta.dispatchEvent(new Event('change', {{ bubbles: true }}));
            return 'filled';
        }})()
        """
        return self._cdp_eval(js) or ""

    def _cdp_fill_srp_inputs(self, words):
        """Fill seed phrase into individual input fields via CDP."""
        words_js = _json.dumps(words)
        js = f"""
        (function() {{
            var words = {words_js};
            var inputs = document.querySelectorAll('input');
            var candidates = [];
            for (var i = 0; i < inputs.length; i++) {{
                var t = (inputs[i].type || '').toLowerCase();
                if (t === 'password' || t === 'checkbox' || t === 'radio' || t === 'submit' || t === 'button' || t === 'hidden') continue;
                if (inputs[i].offsetParent === null) continue;
                candidates.push(inputs[i]);
            }}
            if (candidates.length < words.length) return 'not_enough:' + candidates.length;
            for (var j = 0; j < words.length; j++) {{
                candidates[j].focus();
                candidates[j].value = words[j];
                candidates[j].dispatchEvent(new Event('input', {{ bubbles: true }}));
                candidates[j].dispatchEvent(new Event('change', {{ bubbles: true }}));
            }}
            return 'filled:' + words.length;
        }})()
        """
        return self._cdp_eval(js) or ""

    def _cdp_fill_private_key(self, pk):
        """Fill private key into the private key input/textarea via CDP."""
        pk_js = _json.dumps(pk)
        js = f"""
        (function() {{
            var el = document.querySelector('#private-key-box') ||
                     document.querySelector('input[placeholder*="private key"]') ||
                     document.querySelector('textarea[placeholder*="private key"]') ||
                     document.querySelector('textarea#private-key-box');
            if (!el) return '';
            el.focus();
            el.value = {pk_js};
            el.dispatchEvent(new Event('input', {{ bubbles: true }}));
            el.dispatchEvent(new Event('change', {{ bubbles: true }}));
            return 'filled';
        }})()
        """
        return self._cdp_eval(js) or ""

    def _cdp_wait_for(self, js_condition, timeout=20, poll=0.5):
        """Poll a JS expression via CDP until it returns truthy or timeout."""
        end = time.time() + timeout
        while time.time() < end:
            result = self._cdp_eval(js_condition)
            if result:
                return result
            time.sleep(poll)
        return None

    def _cdp_click_first_available(self, testids, texts=None, timeout=10):
        """Wait and click the first available button by testid or text via CDP."""
        end = time.time() + timeout
        while time.time() < end:
            for tid in testids:
                r = self._cdp_click_by_testid(tid)
                if r:
                    self.logger.debug(f"CDP clicked testid: {tid}")
                    return True
            if texts:
                r = self._cdp_click_by_text(texts)
                if r:
                    self.logger.debug(f"CDP {r}")
                    return True
            time.sleep(0.3)
        return False

    def _discover_extension_id_from_windows(self) -> str:
        from luckyx_automation.core.driver import DriverFactory
        return DriverFactory.discover_extension_id(self.driver, self.logger)

    def _metamask_base_url(self):
        ext_id = (self.context.metamask_extension_id or "").strip()
        if not ext_id:
            ext_id = (settings.METAMASK_EXTENSION_ID or "").strip()

        if ext_id:
            return f"chrome-extension://{ext_id}/home.html"
            
        # Fallback to driver-side discovery if still missing
        from luckyx_automation.core.driver import DriverFactory
        discovered = DriverFactory.discover_extension_id(self.driver, self.logger)
        
        if discovered:
            self.context.metamask_extension_id = discovered
            return f"chrome-extension://{discovered}/home.html"
            
        return None

    def _cfg(self):
        return getattr(self.context, "config", None)

    def _metamask_password(self):
        cfg = self._cfg()
        return ((cfg.metamask_password if cfg else "") or settings.METAMASK_PASSWORD or "").strip()

    def _seed_phrase(self):
        cfg = self._cfg()
        return ((cfg.metamask_seed_phrase if cfg else "") or settings.METAMASK_SEED_PHRASE or "").strip()

    def _private_key(self):
        cfg = self._cfg()
        return ((cfg.metamask_private_key if cfg else "") or settings.METAMASK_PRIVATE_KEY or "").strip()

    def _normalize_seed_phrase(self, srp: str) -> str:
        return " ".join(SRP_WORD_PATTERN.findall((srp or "").strip().lower()))

    def _split_seed_words(self, srp: str):
        normalized = self._normalize_seed_phrase(srp)
        if not normalized:
            return []
        return [w for w in normalized.split(" ") if w]

    def _assert_valid_seed_word_count(self, words):
        if len(words) in ALLOWED_SRP_WORD_COUNTS:
            return
        raise ValueError(
            f"MetaMask supports only {', '.join(map(str, ALLOWED_SRP_WORD_COUNTS))} seed words; got {len(words)}."
        )

    def open_metamask(self, route: str = ""):
        base = self._metamask_base_url()
        if not base:
            return False
        url = f"{base}{route}" if route else base
        try:
            self.driver.get(url)
            return True
        except Exception as e:
            self.logger.warning(f"Failed to open MetaMask URL '{url}': {e}")
            return False

    def _switch_to_metamask_window(self, timeout=20):
        start = time.time()
        original = self.driver.current_window_handle
        ext_id = (self.context.metamask_extension_id or settings.METAMASK_EXTENSION_ID or "").strip().lower()
        while time.time() - start < timeout:
            for handle in list(self.driver.window_handles):
                try:
                    self.driver.switch_to.window(handle)
                    title = (self.driver.title or "").lower()
                    url = (self.driver.current_url or "").lower()
                    if ext_id and url.startswith(f"chrome-extension://{ext_id}/"):
                        return True
                    if "metamask" in title:
                        return True
                except Exception:
                    continue
            time.sleep(0.3)
        try:
            self.driver.switch_to.window(original)
        except Exception:
            pass
        return False

    def _click_first(self, xpaths, timeout=10, label="", texts=None, testids=None):
        """Try Selenium XPath first, fallback to CDP text/testid matching.
        
        Args:
            xpaths: list of XPath selectors for Selenium
            timeout: max seconds to wait
            label: debug label
            texts: list of button text strings for CDP fallback
            testids: list of data-testid values for CDP fallback
        """
        end = time.time() + timeout
        last_err = None
        while time.time() < end:
            # 1. Try standard Selenium click
            for xp in xpaths:
                try:
                    remaining = end - time.time()
                    if remaining <= 0:
                        break
                    local_wait = WebDriverWait(self.driver, min(2, remaining))
                    el = local_wait.until(EC.element_to_be_clickable((By.XPATH, xp)))
                    el.click()
                    return True
                except Exception as e:
                    last_err = e
                    continue
            
            # 2. Heuristic fallback: try to extract text from simple xpath and use CDP
            # This is a generic fallback. For specific flows, use _cdp_click_text directy.
            
            time.sleep(0.2)
        
        if last_err:
            tag = f" [{label}]" if label else ""
            self.logger.debug(f"_click_first{tag} timed out after {timeout}s. URL={self.driver.current_url}, title={self.driver.title}")
            raise last_err
        return False

    def _cdp_click_first_available(self, testids=None, texts=None, timeout=5):
        """Try to click any button matching the provided testids or texts via CDP."""
        end = time.time() + timeout
        testids = testids or []
        texts = texts or []
        
        while time.time() < end:
            if testids and self._cdp_click_testid(testids, timeout=0.5):
                return True
            if texts and self._cdp_click_text(texts, timeout=0.5):
                return True
            time.sleep(0.5)
        return False

    def _import_wallet_with_srp(self, srp: str):
        self.logger.info("Clicking 'Import existing wallet' button...")

        # Step 1: Click "Import an existing wallet" / "我已有一个钱包"
        if not self._cdp_click_first_available(
            testids=["onboarding-import-wallet"],
            texts=["Import an existing wallet", "Import wallet", "我已有一个钱包", "导入现有钱包"],
            timeout=20,
        ):
            raise RuntimeError("Could not find 'Import wallet' button.")
        time.sleep(1)

        # Step 1.5: New MetaMask shows "Import with SRP" choice page
        self._cdp_click_first_available(
            testids=["onboarding-import-with-srp-button"],
            texts=["使用私钥助记词导入", "Import with Secret Recovery Phrase", "Secret Recovery Phrase"],
            timeout=8,
        )
        time.sleep(1)

        # Step 2: Agree to terms (may not appear in newer versions)
        self._cdp_click_first_available(
            testids=["metametrics-i-agree", "metametrics-no-thanks"],
            texts=["I agree", "Agree", "No thanks", "我同意", "同意", "不用了"],
            timeout=3,
        )
        time.sleep(0.5)

        words = self._split_seed_words(srp)
        normalized_srp = " ".join(words)
        if not words:
            raise ValueError("Seed phrase is empty.")
        self._assert_valid_seed_word_count(words)

        # Step 3: Fill seed phrase (textarea or individual inputs)
        self.logger.info("Filling seed phrase...")
        filled = False
        end = time.time() + 25
        while time.time() < end and not filled:
            # Try textarea first
            r = self._cdp_fill_srp_textarea(normalized_srp)
            if r == "filled":
                self.logger.info("Seed phrase filled via textarea.")
                filled = True
                break
            # Try individual inputs
            r = self._cdp_fill_srp_inputs(words)
            if r.startswith("filled"):
                self.logger.info(f"Seed phrase filled via individual inputs ({r}).")
                filled = True
                break
            time.sleep(0.5)

        if not filled:
            raise RuntimeError("MetaMask seed phrase input not found.")

        # Step 4: Confirm SRP
        self.logger.info("Confirming seed phrase...")
        if not self._cdp_click_first_available(
            testids=["import-srp-confirm"],
            texts=["Confirm", "Next", "Continue", "确认", "下一步", "继续"],
            timeout=10,
        ):
            raise RuntimeError("Could not find SRP confirm button.")
        time.sleep(1)

        # Step 5: Set password
        self.logger.info("Setting password...")
        password = self._metamask_password()
        pw_filled = self._cdp_wait_for(
            f"""(function(){{ var inputs = document.querySelectorAll('input[type="password"]'); return inputs.length > 0 ? inputs.length : 0; }})()""",
            timeout=25,
        )
        if not pw_filled:
            raise RuntimeError("Password fields not found.")
        self._cdp_fill_password_fields(password)

        # Step 6: Check terms checkbox
        self._cdp_check_all_checkboxes()
        time.sleep(0.5)

        # Step 7: Click Import / Create
        self.logger.info("Clicking import button...")
        if not self._cdp_click_first_available(
            testids=["create-password-import"],
            texts=["Import", "Create", "Done", "导入", "创建", "完成"],
            timeout=10,
        ):
            raise RuntimeError("Could not find password import button.")

    def _create_new_wallet(self):
        # Step 1: Click "Create a new wallet"
        if not self._cdp_click_first_available(
            testids=["onboarding-create-wallet"],
            texts=["Create a new wallet", "Create a wallet", "创建新钱包", "创建钱包"],
            timeout=20,
        ):
            raise RuntimeError("Could not find 'Create wallet' button.")
        time.sleep(1)

        # Step 2: Agree to terms
        self._cdp_click_first_available(
            testids=["metametrics-i-agree", "metametrics-no-thanks"],
            texts=["I agree", "Agree", "No thanks", "我同意", "同意", "不用了"],
            timeout=12,
        )
        time.sleep(1)

        # Step 3: Set password
        password = self._metamask_password()
        self._cdp_wait_for(
            """(function(){ return document.querySelectorAll('input[type="password"]').length > 0 ? 1 : 0; })()""",
            timeout=25,
        )
        self._cdp_fill_password_fields(password)

        # Step 4: Check terms checkbox
        self._cdp_check_all_checkboxes()
        time.sleep(0.5)

        # Step 5: Click Create
        if not self._cdp_click_first_available(
            testids=["create-password-wallet"],
            texts=["Create", "Continue", "Done", "创建", "继续", "完成"],
            timeout=15,
        ):
            raise RuntimeError("Could not find 'Create password' button.")

    def import_account_private_key(self, private_key: str):
        pk = (private_key or "").strip()
        if not pk:
            return

        self._cdp_click_first_available(
            testids=["account-options-menu-button"],
            texts=["Account options", "账户选项"],
            timeout=10,
        )
        time.sleep(0.5)

        self._cdp_click_first_available(
            testids=[],
            texts=["Import account", "导入账户"],
            timeout=10,
        )
        time.sleep(1)

        r = self._cdp_wait_for(
            """(function(){ return document.querySelector('#private-key-box') || document.querySelector('input[placeholder*="private key"]') || document.querySelector('textarea[placeholder*="private key"]') ? 1 : 0; })()""",
            timeout=10,
        )
        if not r:
            raise RuntimeError("Private key input not found.")

        self._cdp_fill_private_key(pk)
        time.sleep(0.5)

        self._cdp_click_first_available(
            testids=["import-account-confirm-button"],
            texts=["Import", "导入"],
            timeout=10,
        )

    @robust_step(max_retries=2, delay=2)
    def setup_wallet(self):
        """
        Completes the initial 'Import Wallet' flow.
        """
        self.logger.info("Starting MetaMask Setup...")

        srp = self._seed_phrase()
        pk = self._private_key()
        if not (srp or pk):
            raise RuntimeError("Both METAMASK_SEED_PHRASE and METAMASK_PRIVATE_KEY are empty.")
        if not self._metamask_password():
            raise RuntimeError("METAMASK_PASSWORD is empty.")

        if not self.open_metamask("#onboarding/welcome"):
            self.open_metamask("#initialize/welcome")

        if not self._switch_to_metamask_window(timeout=40):
            raise RuntimeError("MetaMask window not found during setup.")

        # Optional "Get started" screen (older MetaMask versions)
        self._cdp_click_first_available(
            testids=["onboarding-get-started"],
            texts=["Get started", "Get Started", "Start", "Continue", "开始使用", "开始", "继续"],
            timeout=5,
        )

        if srp:
            self._import_wallet_with_srp(srp)
        else:
            self._create_new_wallet()
        
        # Completion screens
        self.logger.info("Handling completion screens...")
        self._cdp_click_first_available(
            testids=["onboarding-complete-done"],
            texts=["Got it!", "Got it", "知道了", "了解"],
            timeout=20,
        )
        time.sleep(1)
        
        self._cdp_click_first_available(
            testids=["pin-extension-next"],
            texts=["Next", "下一步"],
            timeout=10,
        )
        time.sleep(1)
        
        self._cdp_click_first_available(
            testids=["pin-extension-done"],
            texts=["Done", "Finish", "完成"],
            timeout=10,
        )
        time.sleep(1)
        
        # Close "What's new" popup
        self._cdp_click_by_testid("popover-close")

        if pk:
            try:
                self.import_account_private_key(pk)
            except Exception as e:
                self.logger.warning(f"Failed to import account by private key: {_sanitize_message(str(e))}")

        self.logger.info("MetaMask setup complete.")

    @robust_step(max_retries=2)
    def connect_wallet(self):
        """
        Handles the 'Connect Wallet' popup flow.
        """
        self.logger.info("Handling Connect Wallet popup...")
        main_window = self.driver.current_window_handle
        
        if self._switch_to_metamask_window(timeout=25):
            try:
                self._cdp_click_first_available(
                    testids=["page-container-footer-next"],
                    texts=["Next", "下一步"],
                    timeout=12,
                )
                time.sleep(0.5)
                
                self._cdp_click_first_available(
                    testids=["page-container-footer-next"],
                    texts=["Connect", "连接"],
                    timeout=12,
                )
                
                self.logger.info("Wallet connected successfully.")
            except Exception as e:
                self.logger.error(f"Error connecting wallet: {_sanitize_message(str(e))}")
                raise
            finally:
                self.driver.switch_to.window(main_window)
        else:
            self.logger.warning("MetaMask popup not found for connection.")

    @robust_step(max_retries=2)
    def sign_message(self):
        """
        Handles the 'Sign' signature request popup.
        """
        self.logger.info("Handling Sign Message popup...")
        main_window = self.driver.current_window_handle
        
        if self._switch_to_metamask_window(timeout=25):
            try:
                # Scroll down via CDP
                self._cdp_eval("""
                (function() {
                    var el = document.querySelector('.signature-request-message__scroll-button');
                    if (el) el.click();
                })()
                """)
                
                self._cdp_click_first_available(
                    testids=["page-container-footer-next", "signature-sign-button"],
                    texts=["Sign", "签名"],
                    timeout=15,
                )
                
                self.logger.info("Message signed successfully.")
            except Exception as e:
                self.logger.error(f"Error signing message: {_sanitize_message(str(e))}")
                raise
            finally:
                self.driver.switch_to.window(main_window)
        else:
            self.logger.warning("MetaMask popup not found for signing.")
