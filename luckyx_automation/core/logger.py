import logging
import sys
from pathlib import Path
from datetime import datetime

class LoggerSetup:
    @staticmethod
    def setup_logger(name: str, run_id: str, log_dir: Path, debug: bool = False):
        """
        Sets up a structured logger that outputs to both file and console.
        """
        # Ensure log directory exists
        log_dir.mkdir(parents=True, exist_ok=True)
        
        logger = logging.getLogger(name)
        logger.setLevel(logging.DEBUG if debug else logging.INFO)
        logger.handlers = []  # Clear existing handlers
        logger.propagate = False
        
        # Formatter
        formatter = logging.Formatter(
            '%(asctime)s [%(levelname)s] [%(name)s] %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
        
        # File Handler (Task specific)
        log_file = log_dir / f"{run_id}.log"
        file_handler = logging.FileHandler(log_file, encoding='utf-8')
        file_handler.setFormatter(formatter)
        file_handler.setLevel(logging.DEBUG) # Always log detailed info to file
        logger.addHandler(file_handler)
        
        # Console Handler
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setFormatter(formatter)
        console_handler.setLevel(logging.DEBUG if debug else logging.INFO)
        logger.addHandler(console_handler)
        
        return logger

def get_run_id():
    """Generates a unique run ID based on timestamp."""
    return datetime.now().strftime("%Y%m%d_%H%M%S")
