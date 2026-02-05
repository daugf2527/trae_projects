import functools
import time
import traceback
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional, Callable
import logging

@dataclass(frozen=True)
class AccountConfig:
    label: str = "default"
    proxy: str = ""
    metamask_password: str = ""
    metamask_seed_phrase: str = ""
    metamask_private_key: str = ""
    email_account: str = ""
    email_password: str = ""
    email_imap_server: str = ""
    invite_code: str = ""

class TaskContext:
    """
    Holds context for a single automation task run.
    """
    def __init__(self, run_id: str, log_dir: Path, screenshots_dir: Path, logger: logging.Logger, config: Optional[AccountConfig] = None):
        self.run_id = run_id
        self.log_dir = log_dir
        self.screenshots_dir = screenshots_dir
        self.driver = None # Will be set later
        self.logger = logger
        self.config = config

    def capture_screenshot(self, name: str):
        """Captures a screenshot with timestamp."""
        if not self.driver:
            self.logger.warning("Driver not initialized, cannot take screenshot.")
            return

        timestamp = datetime.now().strftime("%H%M%S")
        filename = f"{timestamp}_{name}.png"
        filepath = self.screenshots_dir / filename
        
        try:
            self.driver.save_screenshot(str(filepath))
            self.logger.info(f"Screenshot saved: {filepath}")
        except Exception as e:
            self.logger.error(f"Failed to save screenshot: {e}")

def robust_step(max_retries: int = 3, delay: int = 2, screenshot_on_fail: bool = True):
    """
    Decorator to make a method robust with retries and screenshotting.
    Assumes the first argument is 'self' and 'self.context' is a TaskContext instance.
    """
    def decorator(func: Callable):
        @functools.wraps(func)
        def wrapper(self, *args, **kwargs):
            context: Optional[TaskContext] = getattr(self, 'context', None)
            logger = context.logger if context else logging.getLogger("Fallback")
            
            last_exception = None
            for attempt in range(1, max_retries + 1):
                try:
                    logger.debug(f"Executing step '{func.__name__}' (Attempt {attempt}/{max_retries})...")
                    return func(self, *args, **kwargs)
                except Exception as e:
                    last_exception = e
                    logger.warning(f"Step '{func.__name__}' failed (Attempt {attempt}/{max_retries}): {e}")
                    
                    if screenshot_on_fail and context:
                        context.capture_screenshot(f"fail_{func.__name__}_attempt_{attempt}")
                    
                    if attempt < max_retries:
                        time.sleep(delay)
                    else:
                        logger.error(f"Step '{func.__name__}' failed permanently after {max_retries} attempts.")
                        logger.debug(traceback.format_exc())
            
            # If we reach here, re-raise the last exception
            raise last_exception
        return wrapper
    return decorator
