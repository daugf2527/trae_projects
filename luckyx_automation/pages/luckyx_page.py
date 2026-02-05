import time
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from luckyx_automation.config import settings
from luckyx_automation.pages.metamask import MetaMaskController
from luckyx_automation.utils.email_handler import EmailHandler
from luckyx_automation.core.decorators import TaskContext, robust_step

class LuckyXPage:
    def __init__(self, context: TaskContext):
        self.context = context
        self.driver = context.driver
        self.wait = WebDriverWait(self.driver, 30)
        self.logger = context.logger
        self.mm_controller = MetaMaskController(context)
        cfg = getattr(self.context, "config", None)
        self.email_handler = EmailHandler(
            logger=self.logger,
            username=(cfg.email_account if cfg else ""),
            password=(cfg.email_password if cfg else ""),
            imap_server=(cfg.email_imap_server if cfg else ""),
        )

    @robust_step(max_retries=2)
    def open(self):
        """Opens the LuckyX website and waits for load."""
        self.logger.info(f"Opening {settings.LUCKYX_URL}...")
        self.driver.get(settings.LUCKYX_URL)
        self.handle_cloudflare()

    def handle_cloudflare(self):
        """Waits for Cloudflare challenge to pass."""
        self.logger.info("Checking for Cloudflare...")
        try:
            WebDriverWait(self.driver, 60).until(
                lambda d: "just a moment" not in (d.title or "").lower()
            )
            self.wait.until(EC.presence_of_element_located((By.TAG_NAME, "body")))
            self.logger.info("Cloudflare passed or not present.")
        except Exception as e:
            self.logger.warning(f"Cloudflare check timed out or failed: {e}")

    @robust_step(max_retries=2)
    def connect_wallet(self):
        """Performs the Connect Wallet flow."""
        self.logger.info("Initiating Wallet Connection...")
        
        # 1. Click "Connect Wallet" on top right
        connect_btn = self.wait.until(EC.element_to_be_clickable(
            (By.XPATH, "//button[contains(text(), 'Connect Wallet')]")
        ))
        connect_btn.click()
        
        # 2. Select "MetaMask" from modal
        mm_option = self.wait.until(EC.element_to_be_clickable(
            (By.XPATH, "//*[contains(., 'MetaMask') or contains(., 'METAMASK') or contains(., 'metamask')]")
        ))
        mm_option.click()
        
        # 3. Handle MetaMask Popup
        self.mm_controller.connect_wallet()
        
        try:
            self.mm_controller.sign_message()
        except Exception:
            pass
            
        self.logger.info("Wallet connection flow finished.")

    @robust_step(max_retries=2)
    def daily_checkin(self):
        """Performs daily check-in/sign-in if available."""
        self.logger.info("Attempting Daily Check-in...")
        try:
            # Look for "Sign In" or "Check In" button
            checkin_btn = self.driver.find_elements(By.XPATH, "//button[contains(text(), 'Sign In') or contains(text(), 'Check In')]")
            
            if checkin_btn:
                checkin_btn[0].click()
                self.logger.info("Clicked Check-in button.")
                time.sleep(2)
                self.mm_controller.sign_message()
            else:
                self.logger.info("No Check-in button found (maybe already checked in?).")
                
        except Exception as e:
            self.logger.warning(f"Error during check-in: {e}")

    @robust_step(max_retries=2)
    def bind_email(self):
        """Binds email address."""
        self.logger.info("Starting Email Binding...")
        cfg = getattr(self.context, "config", None)
        email_account = (cfg.email_account if cfg else settings.EMAIL_ACCOUNT) or ""
        
        # Navigate to Bind Email
        bind_btn = self.driver.find_elements(By.XPATH, "//button[contains(text(), 'Bind Email')]")
        if not bind_btn:
            for xp in [
                "//button[contains(@aria-label, 'Profile')]",
                "//button[contains(@aria-label, 'Account')]",
                "//button[contains(@aria-label, 'Menu')]",
                "//*[name()='svg' and (@aria-label='account' or @aria-label='profile')]/ancestor::button[1]",
            ]:
                try:
                    self.wait.until(EC.element_to_be_clickable((By.XPATH, xp))).click()
                    break
                except Exception:
                    continue
            bind_btn = self.driver.find_elements(By.XPATH, "//button[contains(text(), 'Bind Email')]")
            if not bind_btn:
                self.logger.warning("Bind Email button not found.")
                return

        bind_btn[0].click()
        
        # Input Email
        email_input = self.wait.until(EC.presence_of_element_located(
            (By.XPATH, "//input[@type='email' or contains(@placeholder, 'Email')]")
        ))
        email_input.clear()
        email_input.send_keys(email_account)
        
        # Click Send Code
        send_code_btn = self.driver.find_element(By.XPATH, "//button[contains(text(), 'Send') and contains(text(), 'Code')]|//button[contains(text(), 'Send')]")
        send_code_btn.click()
        
        # Fetch Code
        code = self.email_handler.get_verification_code(subject_keyword="LuckyX")
        if code:
            code_input = self.driver.find_element(By.XPATH, "//input[contains(@placeholder, 'Code')]")
            code_input.send_keys(code)
            
            confirm_btn = self.driver.find_element(By.XPATH, "//button[contains(text(), 'Confirm') or contains(text(), 'Bind')]")
            confirm_btn.click()
            self.logger.info("Email binding submitted.")
        else:
            self.logger.error("Failed to get verification code.")

    @robust_step(max_retries=2)
    def handle_invites(self):
        """Handles inviting friends and entering invite code."""
        self.logger.info("Handling Invites...")
        cfg = getattr(self.context, "config", None)
        invite_code = (cfg.invite_code if cfg else settings.INVITE_CODE) or ""
        label = (cfg.label if cfg else "") or (cfg.email_account if cfg else settings.EMAIL_ACCOUNT) or ""
        
        # Navigate to Invite section
        invite_nav = self.driver.find_elements(By.XPATH, "//div[contains(text(), 'Invite Friends')]")
        if invite_nav:
            invite_nav[0].click()
        else:
            self.driver.get(settings.LUCKYX_URL)
            self.handle_cloudflare()
        
        # 1. Get My Invite Link
        try:
            invite_link_input = self.wait.until(EC.presence_of_element_located((By.XPATH, "//input[contains(@value, 'luckyx') or contains(@value, 'LUCKY') or contains(@value, 'invite')]")))
            my_link = invite_link_input.get_attribute("value")
            self.logger.info(f"My Invite Link: {my_link}")
            
            out_path = self.context.log_dir / "my_invite_links.txt"
            with open(out_path, "a", encoding="utf-8") as f:
                f.write(f"{label}\t{my_link}\n")
        except Exception as e:
            self.logger.warning(f"Could not extract invite link: {e}")

        # 2. Enter Invite Code
        if invite_code:
            try:
                invite_code_input = self.driver.find_elements(By.XPATH, "//input[contains(@placeholder, 'Invite Code')]")
                if invite_code_input:
                    invite_code_input[0].send_keys(invite_code)
                    confirm_btn = self.driver.find_element(By.XPATH, "//button[contains(text(), 'Confirm') or contains(text(), 'Submit')]")
                    confirm_btn.click()
                    self.logger.info("Invite code submitted.")
                else:
                    self.logger.info("Invite code input not found (maybe already bound?).")
            except Exception as e:
                self.logger.warning(f"Error entering invite code: {e}")
