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
        mail = None
        
        try:
            # Establish connection once outside the loop
            mail = imaplib.IMAP4_SSL(self.imap_server, timeout=30)
            mail.login(self.username, self.password)
            self.logger.debug("IMAP connection established.")
            
            while time.time() - start_time < wait_time:
                try:
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
                            subj_raw = msg.get("Subject", "")
                            subj = ""
                            if subj_raw:
                                decoded_parts = decode_header(subj_raw)
                                for part, enc in decoded_parts:
                                    if isinstance(part, bytes):
                                        subj += part.decode(enc or "utf-8", errors="ignore")
                                    else:
                                        subj += part
                            
                            if subject_keyword.lower() not in subj.lower():
                                continue
                            
                            # Found matching subject
                            body = ""
                            if msg.is_multipart():
                                for part in msg.walk():
                                    if part.get_content_type() == "text/plain":
                                        payload = part.get_payload(decode=True)
                                        body = payload.decode(errors="ignore") if payload else ""
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
                    # Connection error - try to reconnect
                    self.logger.warning(f"Error during email check: {_sanitize_message(str(e))}, reconnecting...")
                    try:
                        if mail is not None:
                            mail.logout()
                    except Exception:
                        pass
                    try:
                        mail = imaplib.IMAP4_SSL(self.imap_server, timeout=30)
                        mail.login(self.username, self.password)
                    except Exception as reconnect_err:
                        self.logger.error(f"Failed to reconnect: {_sanitize_message(str(reconnect_err))}")
                        time.sleep(poll_interval)
                        continue
                
                time.sleep(poll_interval)
        finally:
            try:
                if mail is not None:
                    mail.logout()
            except Exception:
                pass
            
        self.logger.warning("Timeout waiting for email verification code.")
        return None
