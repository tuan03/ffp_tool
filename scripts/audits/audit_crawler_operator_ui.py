"""Exercise only the active, isolated auth UI; never contact external services."""
import argparse
import base64
import hashlib
import json
from urllib.parse import urlsplit

from cryptography import x509
from cryptography.hazmat.primitives import serialization
from playwright.sync_api import Error as PlaywrightError, sync_playwright

from local_auth_sandbox import current_run


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manual", action="store_true", help="Leave a scoped browser open for manual acceptance")
    options = parser.parse_args()
    directory = current_run()
    status = json.loads((directory / "status.json").read_text())
    assert status["state"] == "running" and status.get("claimsDisabled"), "Start the UI sandbox first"
    origin = status["origin"]
    assert urlsplit(origin).hostname == "127.0.0.1"
    credentials = json.loads((directory / "operator-login.json").read_text())
    cert = x509.load_pem_x509_certificate((directory / "tls.pem").read_bytes())
    public_key = cert.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    pin = base64.b64encode(hashlib.sha256(public_key).digest()).decode()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=not options.manual,
            args=["--ignore-certificate-errors-spki-list=" + pin])
        context = browser.new_context()
        context.route("**/*", lambda route: route.continue_() if route.request.url.startswith(origin + "/") else route.abort())
        page = context.new_page()
        page.goto(origin + "/amazon-crawler")
        page.get_by_role("heading", name="Đăng nhập Crawler Operator").wait_for()
        page.get_by_label("Operator", exact=True).fill(credentials["username"])
        page.get_by_label("Mật khẩu", exact=True).fill("incorrect-sandbox-password")
        page.get_by_role("button", name="Đăng nhập", exact=True).click()
        page.get_by_role("alert").filter(has_text="Đăng nhập không thành công").wait_for()
        page.get_by_label("Mật khẩu", exact=True).fill(credentials["password"])
        page.get_by_role("button", name="Đăng nhập", exact=True).click()
        page.get_by_role("button", name="Đăng xuất operator").wait_for()
        page.get_by_text("FFP isolated auth test", exact=True).first.wait_for()
        storage = page.evaluate("JSON.stringify({local: {...localStorage}, session: {...sessionStorage}})")
        assert credentials["password"] not in storage
        print("PASS: bad login rejected; operator login loads the real isolated agent; no password in browser storage")
        page.screenshot(path=str(directory / "crawler-ui.png"), full_page=True)
        if options.manual:
            print("Isolated UI ready. Close this browser window to finish. No external requests or real leases are allowed.", flush=True)
            try:
                while browser.is_connected() and context.pages:
                    page.wait_for_timeout(1000)
            except PlaywrightError:
                if browser.is_connected() and context.pages:
                    raise
        else:
            page.locator("textarea").first.fill("B0FR4MSS2H")
            with page.expect_response(lambda response: response.url == origin + "/api/v1/crawl-jobs" and response.request.method == "POST") as created:
                page.get_by_role("button", name="Start (1)", exact=True).click()
            assert created.value.ok, "UI job creation failed"
            job = created.value.json()
            job_id = job.get("id", job.get("jobId"))
            assert job_id
            page.get_by_text(job_id, exact=True).first.wait_for()
            with page.expect_response(lambda response: "/" + job_id + "/cancel" in response.url) as cancelled:
                page.get_by_role("button", name="Hủy job", exact=True).first.click()
            assert cancelled.value.ok, "UI cancellation failed"
            # Completed cancellation may remove the job before the next DOM poll.
            page.wait_for_function("""jobId => {
                const label = [...document.querySelectorAll('p')].find(node => node.textContent === jobId);
                return !label || label.parentElement.textContent.includes('cancelled');
            }""", arg=job_id)
            print("PASS: real UI creates, lists and cancels an isolated PostgreSQL job (no leases/crawl)")
            page.get_by_role("button", name="Đăng xuất operator").click()
            page.get_by_role("heading", name="Đăng nhập Crawler Operator").wait_for()
            page.reload()
            page.get_by_role("heading", name="Đăng nhập Crawler Operator").wait_for()
            print("PASS: logout and reload require login again")
            page.get_by_label("Operator", exact=True).fill(credentials["username"])
            page.get_by_label("Mật khẩu", exact=True).fill(credentials["password"])
            page.get_by_role("button", name="Đăng nhập", exact=True).click()
            page.get_by_role("button", name="Đăng xuất operator").wait_for()
            page.route("**/api/v1/clients", lambda route: route.fulfill(status=401, body="{}"), times=1)
            page.get_by_role("heading", name="Đăng nhập Crawler Operator").wait_for()
            print("PASS: a simulated operator 401 clears the UI session")
        browser.close()


if __name__ == "__main__":
    main()
