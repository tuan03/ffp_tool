from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from pinterest.image_crawler.discovery import browser_profile_dir
    from pinterest.shared.utils import env
else:
    from .discovery import browser_profile_dir
    from ..shared.utils import env


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Open a persistent Pinterest browser profile for manual login.")
    parser.add_argument("--profile-dir", default=env("PINTEREST_BROWSER_PROFILE_DIR", ""))
    parser.add_argument("--timeout", type=int, default=int(env("PINTEREST_BROWSER_LOGIN_TIMEOUT", "600") or 600))
    parser.add_argument("--url", default="https://www.pinterest.com/login/")
    return parser.parse_args()


def cleanup_profile_locks(profile_dir: Path) -> None:
    """Clean up stale Chromium singleton locks left by abnormal exits."""
    for lock_name in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
        lock_file = profile_dir / lock_name
        try:
            if lock_file.is_symlink() or lock_file.exists():
                lock_file.unlink(missing_ok=True)
        except Exception:
            pass


def has_login_cookie(context) -> bool:
    try:
        cookies = context.cookies()
    except Exception:
        try:
            cookies = context.cookies("https://www.pinterest.com")
        except Exception:
            return False

    for cookie in cookies:
        domain = cookie.get("domain") or ""
        if "pinterest" not in domain:
            continue
        name = cookie.get("name")
        value = str(cookie.get("value") or "").strip()
        # _auth is "1" when authenticated ("0" when guest/logged out)
        if name == "_auth" and value == "1":
            return True
        # _pinterest_sess contains a long signed session token for authenticated accounts
        if name == "_pinterest_sess" and len(value) > 30 and value != "0":
            return True
    return False


def page_looks_logged_in(page) -> bool:
    try:
        if page.is_closed():
            return False
        return bool(
            page.evaluate(
                """
                () => {
                  const path = location.pathname.toLowerCase();
                  if (path.includes('/login') || path.includes('/signup') || path.includes('/register')) return false;

                  // Positive indicator: profile button, avatar, or saved tab
                  const hasProfile = !!(
                    document.querySelector('[data-test-id="header-profile"]') ||
                    document.querySelector('[data-test-id="header-accounts-options-button"]') ||
                    document.querySelector('button[aria-label*="profile" i]') ||
                    document.querySelector('button[aria-label*="hồ sơ" i]') ||
                    document.querySelector('a[href*="/_saved/"]') ||
                    document.querySelector('[data-test-id="saved-tab"]')
                  );
                  if (hasProfile) return true;

                  // Negative indicator: unauthenticated action buttons
                  const hasLoginButtons = !!(
                    document.querySelector('[data-test-id="simple-login-button"]') ||
                    document.querySelector('a[href*="/login/"]') ||
                    document.querySelector('a[href*="/signup/"]')
                  );
                  if (hasLoginButtons) return false;

                  // Text check across English & Vietnamese
                  const text = Array.from(document.querySelectorAll('button, a'))
                    .map((el) => el.textContent || '')
                    .join('\\n')
                    .toLowerCase();
                  const unauthWords = ['log in', 'sign up', 'đăng nhập', 'đăng ký'];
                  const hasUnauthWord = unauthWords.some((w) => text.includes(w));
                  return !hasUnauthWord;
                }
                """
            )
        )
    except Exception:
        return False


def main() -> int:
    args = parse_args()
    profile_dir = browser_profile_dir(args.profile_dir)
    profile_dir.mkdir(parents=True, exist_ok=True)
    cleanup_profile_locks(profile_dir)

    try:
        from playwright.sync_api import sync_playwright
    except Exception as exc:
        print(f"ERROR: Playwright is not installed or unavailable: {exc}", flush=True)
        print("Install with: pip install playwright && playwright install chromium", flush=True)
        return 1

    print(f"Pinterest browser profile: {profile_dir}", flush=True)
    print("A Chromium window will open. Log in to Pinterest there.", flush=True)
    print("The window will close automatically after login is detected, or when timeout expires.", flush=True)

    deadline = time.time() + max(30, args.timeout)
    with sync_playwright() as playwright:
        channels_to_try = [None, "chrome"] if sys.platform != "win32" else [None, "chrome", "msedge"]
        context = None
        last_exc = None
        for channel in channels_to_try:
            try:
                launch_args = {
                    "user_data_dir": str(profile_dir),
                    "headless": False,
                    "viewport": {"width": 1366, "height": 900},
                    "locale": env("PINTEREST_LOCALE", "en-US"),
                    "args": [
                        "--disable-blink-features=AutomationControlled",
                        "--disable-dev-shm-usage",
                        "--no-first-run",
                        "--no-default-browser-check",
                        "--start-maximized",
                    ],
                }
                if channel:
                    launch_args["channel"] = channel
                context = playwright.chromium.launch_persistent_context(**launch_args)
                break
            except Exception as exc:
                print(f"Notice: Channel '{channel}' failed to launch: {exc}", flush=True)
                last_exc = exc
                continue

        if context is None:
            if last_exc:
                raise last_exc
            raise RuntimeError("Failed to launch any browser context")
        page = context.pages[0] if context.pages else context.new_page()
        try:
            page.goto(args.url, wait_until="domcontentloaded", timeout=45_000)
            try:
                page.bring_to_front()
            except Exception:
                pass
        except Exception as exc:
            print(f"WARNING: Could not open Pinterest login page: {exc}", flush=True)

        while time.time() < deadline:
            try:
                # If user closed all browser pages/windows, check cookies and exit cleanly
                if not context.pages or (page and page.is_closed()):
                    if has_login_cookie(context):
                        print("Pinterest login detected from saved cookies.", flush=True)
                        try:
                            context.close()
                        except Exception:
                            pass
                        return 0
                    print("Browser window closed by user.", flush=True)
                    break

                if has_login_cookie(context) and page_looks_logged_in(page):
                    print("Pinterest login detected. Saved browser profile.", flush=True)
                    try:
                        context.close()
                    except Exception:
                        pass
                    return 0
            except Exception as loop_err:
                if "closed" in str(loop_err).lower() or "target" in str(loop_err).lower():
                    if has_login_cookie(context):
                        print("Pinterest login detected from saved cookies.", flush=True)
                        try:
                            context.close()
                        except Exception:
                            pass
                        return 0
                    break
                time.sleep(1)
                continue
            time.sleep(2)

        print("Login wait timed out. If you finished login, the profile may still be saved.", flush=True)
        try:
            context.close()
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
