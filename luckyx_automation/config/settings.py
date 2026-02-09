import os
from pathlib import Path
from dotenv import load_dotenv

# Base Paths
BASE_DIR = Path(__file__).resolve().parent.parent

# Load environment variables from .env in BASE_DIR (must happen before any os.getenv calls)
load_dotenv(BASE_DIR / ".env")

ASSETS_DIR = BASE_DIR / "assets"
LOGS_DIR = Path(os.getenv("LOGS_DIR", BASE_DIR / "logs"))

# Ensure directories exist
ASSETS_DIR.mkdir(exist_ok=True)
LOGS_DIR.mkdir(exist_ok=True)

# MetaMask Settings
METAMASK_EXTENSION_PATH = ASSETS_DIR / "metamask-extension"  # Unzipped extension folder
METAMASK_EXTENSION_ID = os.getenv("METAMASK_EXTENSION_ID", "")
METAMASK_PASSWORD = os.getenv("METAMASK_PASSWORD", "")
METAMASK_SEED_PHRASE = os.getenv("METAMASK_SEED_PHRASE", "")
METAMASK_PRIVATE_KEY = os.getenv("METAMASK_PRIVATE_KEY", "")

CAPSOLVER_API_KEY = os.getenv("CAPSOLVER_API_KEY", "")

# Email Settings (IMAP)
EMAIL_ACCOUNT = os.getenv("EMAIL_ACCOUNT", "")
EMAIL_PASSWORD = os.getenv("EMAIL_PASSWORD", "")  # App Password
EMAIL_IMAP_SERVER = os.getenv("EMAIL_IMAP_SERVER", "imap.gmail.com")

# LuckyX Settings
LUCKYX_URL = "https://app.luckyx.world/"
INVITE_CODE = os.getenv("INVITE_CODE", "") # The code to bind

# Browser Settings
HEADLESS = os.getenv("HEADLESS", "false").lower() == "true"
PROXY = os.getenv("PROXY", "") # Format: http://user:pass@ip:port
CHROME_USER_DATA_DIR = os.getenv("CHROME_USER_DATA_DIR", "")
CHROME_BINARY = os.getenv("CHROME_BINARY", "")

# Batch Settings
ACCOUNTS_FILE = os.getenv("ACCOUNTS_FILE", "")
ACCOUNTS_JSON = os.getenv("ACCOUNTS_JSON", "")

# Proxy Pool Settings
PROXY_POOL_URL = os.getenv("PROXY_POOL_URL", "")
PROXY_POOL_HEADERS_JSON = os.getenv("PROXY_POOL_HEADERS_JSON", "")
PROXY_POOL_TIMEOUT = float(os.getenv("PROXY_POOL_TIMEOUT", "10"))
PROXY_POOL_FORCE = os.getenv("PROXY_POOL_FORCE", "false").lower() == "true"
