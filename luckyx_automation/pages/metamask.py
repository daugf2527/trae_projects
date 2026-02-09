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

    def _click_first(self, xpaths, timeout=10):
        end = time.time() + timeout
        last_err = None
        while time.time() < end:
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
            time.sleep(0.2)
        if last_err:
            raise last_err
        return False

    def _import_wallet_with_srp(self, srp: str):
        self._click_first([
            "//button[contains(., 'Import an existing wallet')]",
            "//button[contains(., 'Import wallet')]",
            "//button[contains(., 'Import an existing')]",
            "//button[contains(., 'Import')]",
        ], timeout=20)

        self._click_first([
            "//button[contains(., 'I agree')]",
            "//button[contains(., 'Agree')]",
            "//button[contains(., 'No thanks')]",
            "//button[@data-testid='metametrics-i-agree']",
        ], timeout=12)

        words = self._split_seed_words(srp)
        normalized_srp = " ".join(words)
        if not words:
            raise ValueError("Seed phrase is empty.")
        self._assert_valid_seed_word_count(words)

        seed_textarea = None
        seed_inputs = []
        end = time.time() + 25
        while time.time() < end:
            try:
                for el in self.driver.find_elements(By.XPATH, "//textarea"):
                    if el.is_displayed():
                        seed_textarea = el
                        break
            except Exception:
                seed_textarea = None

            if seed_textarea:
                break

            try:
                candidates = []
                for el in self.driver.find_elements(By.XPATH, "//input"):
                    try:
                        if not el.is_displayed():
                            continue
                        t = (el.get_attribute("type") or "").strip().lower()
                        if t in ("password", "checkbox", "radio", "submit", "button", "hidden"):
                            continue
                        candidates.append(el)
                    except Exception:
                        continue
                if len(candidates) >= 12:
                    seed_inputs = candidates
                    break
            except Exception:
                seed_inputs = []
            time.sleep(0.2)

        if seed_textarea:
            seed_textarea.clear()
            seed_textarea.send_keys(normalized_srp)
        elif seed_inputs:
            if len(seed_inputs) < len(words):
                raise ValueError(f"Seed phrase words count {len(words)} does not match input fields {len(seed_inputs)}.")
            for i, word in enumerate(words):
                try:
                    seed_inputs[i].clear()
                except Exception:
                    pass
                seed_inputs[i].send_keys(word)
        else:
            raise RuntimeError("MetaMask seed phrase input not found.")

        self._click_first([
            "//button[@data-testid='import-srp-confirm']",
            "//button[contains(., 'Confirm')]",
            "//button[contains(., 'Next')]",
            "//button[contains(., 'Continue')]",
            "//button[@type='submit']",
        ], timeout=10)

        password = self._metamask_password()
        end = time.time() + 25
        pw_inputs = []
        while time.time() < end:
            pw_inputs = []
            for el in self.driver.find_elements(By.XPATH, "//input[@type='password']"):
                try:
                    if el.is_displayed():
                        pw_inputs.append(el)
                except Exception:
                    continue
            if pw_inputs:
                break
            time.sleep(0.2)
        if len(pw_inputs) >= 2:
            for el in pw_inputs[:2]:
                try:
                    el.clear()
                except Exception:
                    pass
                el.send_keys(password)
        elif len(pw_inputs) == 1:
            try:
                pw_inputs[0].clear()
            except Exception:
                pass
            pw_inputs[0].send_keys(password)

        try:
            for cb in self.driver.find_elements(By.XPATH, "//input[@type='checkbox']"):
                if not cb.is_displayed():
                    continue
                if not cb.is_selected():
                    cb.click()
                break
        except Exception:
            pass

        self._click_first([
            "//button[@data-testid='create-password-import']",
            "//button[contains(., 'Import')]",
            "//button[contains(., 'Create')]",
            "//button[contains(., 'Done')]",
            "//button[@type='submit']",
        ], timeout=10)

    def _create_new_wallet(self):
        self._click_first([
            "//button[contains(., 'Create a new wallet')]",
            "//button[contains(., 'Create a wallet')]",
            "//button[contains(., 'Create new wallet')]",
            "//button[contains(., 'Create')]",
        ], timeout=20)

        self._click_first([
            "//button[contains(., 'I agree')]",
            "//button[contains(., 'Agree')]",
            "//button[@data-testid='metametrics-i-agree']",
            "//button[@data-testid='metametrics-no-thanks']",
            "//button[contains(., 'No thanks')]",
        ], timeout=12)

        password = self._metamask_password()
        end = time.time() + 25
        pw_inputs = []
        while time.time() < end:
            pw_inputs = []
            for el in self.driver.find_elements(By.XPATH, "//input[@type='password']"):
                try:
                    if el.is_displayed():
                        pw_inputs.append(el)
                except Exception:
                    continue
            if pw_inputs:
                break
            time.sleep(0.2)
        if len(pw_inputs) >= 2:
            for el in pw_inputs[:2]:
                try:
                    el.clear()
                except Exception:
                    pass
                el.send_keys(password)
        elif len(pw_inputs) == 1:
            try:
                pw_inputs[0].clear()
            except Exception:
                pass
            pw_inputs[0].send_keys(password)

        try:
            for cb in self.driver.find_elements(By.XPATH, "//input[@type='checkbox']"):
                if not cb.is_displayed():
                    continue
                if not cb.is_selected():
                    cb.click()
                break
        except Exception:
            pass

        self._click_first([
            "//button[@data-testid='create-password-wallet']",
            "//button[contains(., 'Create')]",
            "//button[contains(., 'Continue')]",
            "//button[contains(., 'Done')]",
            "//button[@type='submit']",
        ], timeout=15)

    def import_account_private_key(self, private_key: str):
        pk = (private_key or "").strip()
        if not pk:
            return

        self._click_first([
            "//button[@data-testid='account-options-menu-button']",
            "//button[contains(@aria-label, 'Account options')]",
            "//button[contains(@aria-label, 'Account')]",
        ], timeout=10)

        self._click_first([
            "//div[contains(., 'Import account')]",
            "//button[contains(., 'Import account')]",
            "//span[contains(., 'Import account')]/ancestor::button[1]",
        ], timeout=10)

        pk_input = None
        for xp in [
            "//input[@id='private-key-box']",
            "//input[contains(@placeholder, 'private key')]",
            "//textarea[contains(@placeholder, 'private key')]",
            "//textarea[@id='private-key-box']",
        ]:
            try:
                pk_input = WebDriverWait(self.driver, 10).until(EC.presence_of_element_located((By.XPATH, xp)))
                break
            except Exception:
                continue
        if pk_input is None:
            raise RuntimeError("Private key input not found.")

        pk_input.clear()
        pk_input.send_keys(pk)

        self._click_first([
            "//button[contains(., 'Import')]",
            "//button[@data-testid='import-account-confirm-button']",
        ], timeout=10)

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
        self.open_metamask("#unlock")

        if not self.context.metamask_extension_id:
            if not settings.METAMASK_EXTENSION_ID:
                self.open_metamask("#onboarding/welcome")

        if not self._switch_to_metamask_window(timeout=40):
            raise RuntimeError("MetaMask window not found during setup.")

        try:
            self._click_first(
                [
                    "//button[contains(., 'Get started')]",
                    "//button[contains(., 'Get Started')]",
                    "//button[contains(., 'Start')]",
                    "//button[contains(., 'Continue')]",
                    "//button[@data-testid='onboarding-get-started']",
                ],
                timeout=5,
            )
        except Exception:
            pass

        if srp:
            self._import_wallet_with_srp(srp)
        else:
            self._create_new_wallet()
        
        # Completion screens
        self._click_first([
            "//button[contains(., 'Got it!')]",
            "//button[contains(., 'Got it')]",
            "//button[@data-testid='onboarding-complete-done']",
        ], timeout=20)
        
        self._click_first([
            "//button[contains(., 'Next')]",
        ], timeout=10)
        
        self._click_first([
            "//button[contains(., 'Done')]",
            "//button[contains(., 'Finish')]",
        ], timeout=10)
        
        # Close "What's new" popup
        try:
            close_btn = self.driver.find_element(By.XPATH, "//button[@data-testid='popover-close']")
            close_btn.click()
        except Exception:
            pass

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
                self._click_first([
                    "//button[contains(., 'Next')]",
                    "//button[@data-testid='page-container-footer-next']",
                ], timeout=12)
                
                self._click_first([
                    "//button[contains(., 'Connect')]",
                    "//button[@data-testid='page-container-footer-next']",
                ], timeout=12)
                
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
                # Scroll down
                try:
                    arrow = self.driver.find_element(By.CLASS_NAME, "signature-request-message__scroll-button")
                    arrow.click()
                except Exception:
                    pass
                
                self._click_first([
                    "//button[contains(., 'Sign')]",
                    "//button[@data-testid='page-container-footer-next']",
                ], timeout=15)
                
                self.logger.info("Message signed successfully.")
            except Exception as e:
                self.logger.error(f"Error signing message: {_sanitize_message(str(e))}")
                raise
            finally:
                self.driver.switch_to.window(main_window)
        else:
            self.logger.warning("MetaMask popup not found for signing.")
