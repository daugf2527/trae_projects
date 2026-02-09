import imaplib
import email
import re
import time
from email.header import decode_header
import logging
from typing import Optional
from luckyx_automation.config import settings
from luckyx_automation.core.decorators import _sanitize_message

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
                mail = imaplib.IMAP4_SSL(self.imap_server, timeout=30)
                mail.login(self.username, self.password)
                typ, data = mail.select("inbox")
                
                if typ != "OK":
                    time.sleep(poll_interval)
                    continue

                # Optimization: Directly fetch last 5 messages instead of SEARCH ALL
                try:
                    num_msgs = int(data[0])
                except (ValueError, IndexError):
                    num_msgs = 0

                if num_msgs == 0:
                    time.sleep(poll_interval)
                    continue

                start_id = max(1, num_msgs - 4)
                end_id = num_msgs
                status, msg_data = mail.fetch(f"{start_id}:{end_id}", "(RFC822)")
                
                if status != "OK":
                    time.sleep(poll_interval)
                    continue

                # msg_data contains tuples of (header, body) and closing parenthesis strings
                # We need to parse them. They come in order.
                for response_part in reversed(msg_data):
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
                self.logger.warning(f"Error checking email: {_sanitize_message(str(e))}")
            finally:
                try:
                    if mail is not None:
                        mail.logout()
                except Exception:
                    pass
            
            time.sleep(poll_interval)
            
        self.logger.warning("Timeout waiting for email verification code.")
        return None
