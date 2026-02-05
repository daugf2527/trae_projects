import imaplib
import email
import re
import time
from email.header import decode_header
import logging
from typing import Optional
from luckyx_automation.config import settings

class EmailHandler:
    def __init__(
        self,
        logger: Optional[logging.Logger] = None,
        username: str = "",
        password: str = "",
        imap_server: str = "",
    ):
        self.username = username or settings.EMAIL_ACCOUNT
        self.password = password or settings.EMAIL_PASSWORD
        self.imap_server = imap_server or settings.EMAIL_IMAP_SERVER
        self.logger = logger or logging.getLogger("EmailHandler")

    def get_verification_code(self, subject_keyword="LuckyX", wait_time=60, poll_interval=5):
        """
        Polls the inbox for a recent email containing the subject_keyword and extracts a verification code.
        """
        self.logger.info(f"Waiting for email with subject containing '{subject_keyword}'...")
        start_time = time.time()
        
        while time.time() - start_time < wait_time:
            mail = None
            try:
                mail = imaplib.IMAP4_SSL(self.imap_server)
                mail.login(self.username, self.password)
                mail.select("inbox")

                # Search for emails
                # SEARCH since <date> could be added for optimization, but usually just fetching last few is fine
                status, messages = mail.search(None, "ALL")
                
                if status != "OK":
                    time.sleep(poll_interval)
                    continue

                email_ids = messages[0].split()
                # Check the last 3 emails
                for e_id in reversed(email_ids[-3:]):
                    status, msg_data = mail.fetch(e_id, "(RFC822)")
                    for response_part in msg_data:
                        if isinstance(response_part, tuple):
                            msg = email.message_from_bytes(response_part[1])
                            
                            # Decode subject
                            raw_subject = msg.get("Subject", "") or ""
                            decoded = decode_header(raw_subject)
                            subject_part, encoding = decoded[0] if decoded else ("", None)
                            if isinstance(subject_part, bytes):
                                subject = subject_part.decode(encoding if encoding else "utf-8", errors="ignore")
                            else:
                                subject = str(subject_part)
                            
                            if subject_keyword.lower() in subject.lower():
                                # Found the email, extract body
                                body = ""
                                if msg.is_multipart():
                                    for part in msg.walk():
                                        ctype = (part.get_content_type() or "").lower()
                                        if ctype in ("text/plain", "text/html"):
                                            payload = part.get_payload(decode=True)
                                            if payload:
                                                body = payload.decode(errors="ignore")
                                                break
                                else:
                                    payload = msg.get_payload(decode=True)
                                    body = payload.decode(errors="ignore") if payload else ""
                                
                                # Try to find a 6-digit code
                                match = re.search(r'\b\d{6}\b', body)
                                if match:
                                    code = match.group(0)
                                    self.logger.info("Found verification code.")
                                    return code
            except Exception as e:
                self.logger.warning(f"Error checking email: {e}")
            finally:
                try:
                    if mail is not None:
                        mail.logout()
                except Exception:
                    pass
            
            time.sleep(poll_interval)
            
        self.logger.warning("Timeout waiting for email verification code.")
        return None
