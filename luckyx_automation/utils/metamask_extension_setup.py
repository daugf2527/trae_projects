import re
import shutil
import struct
import subprocess
import sys
import urllib.request
import zipfile
import io
from pathlib import Path


def _get_chrome_version() -> str:
    import platform
    if platform.system() == "Darwin":
        candidates = [
            "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        ]
    else:
        candidates = [
            "/usr/bin/google-chrome-for-testing",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/google-chrome",
            "/usr/bin/chromium-browser",
            "/usr/bin/chromium",
        ]
    for chrome_bin in candidates:
        try:
            out = subprocess.check_output([chrome_bin, "--version"], text=True, timeout=5).strip()
            m = re.search(r"(\d+\.\d+\.\d+\.\d+)", out)
            if m:
                return m.group(1)
        except Exception:
            continue
    return "120.0.0.0"


def download_and_extract_metamask(target_dir: Path, extension_id: str = "nkbihfbeogaeaoehlefnkodbefgpgknn") -> Path:
    prodversion = _get_chrome_version()
    url = (
        "https://clients2.google.com/service/update2/crx"
        f"?response=redirect&prodversion={prodversion}"
        "&acceptformat=crx3"
        f"&x=id%3D{extension_id}%26installsource%3Dondemand%26uc"
    )

    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "*/*",
        },
    )

    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()

    if data[:4] != b"Cr24":
        raise RuntimeError(f"Download did not return a CRX. First bytes={data[:32]!r}")

    header_size = struct.unpack("<I", data[8:12])[0]
    zip_start = 12 + header_size
    zip_bytes = data[zip_start:]
    if zip_bytes[:2] != b"PK":
        raise RuntimeError("CRX payload is not a ZIP.")

    if target_dir.exists():
        shutil.rmtree(target_dir)
    target_dir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        for member in zf.namelist():
            dest = (target_dir / member).resolve()
            if not str(dest).startswith(str(target_dir.resolve())):
                raise RuntimeError(f"Zip Slip detected: {member}")
        zf.extractall(target_dir)

    manifest = target_dir / "manifest.json"
    if not manifest.exists():
        raise RuntimeError(f"manifest.json not found after extraction: {manifest}")
    return target_dir


def main() -> int:
    base = Path(__file__).resolve().parent.parent
    target = base / "assets" / "metamask-extension"
    try:
        out = download_and_extract_metamask(target)
        print(str(out))
        return 0
    except Exception as e:
        sys.stderr.write(f"{e}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
