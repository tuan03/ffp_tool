"""Opt-in OS vault acceptance probe. Never reads or modifies an FFP token."""
import secrets
import uuid

import ffp_worker


def probe():
    vault = ffp_worker.secret_store()
    service = "ffp-seo-acceptance-" + str(uuid.uuid4())
    account = "temporary-probe"
    secret = secrets.token_urlsafe(32)
    written = False
    try:
        vault.set_password(service, account, secret)
        written = True
        if vault.get_password(service, account) != secret:
            raise RuntimeError("OS vault read-back failed")
    finally:
        if written:
            vault.delete_password(service, account)
    if vault.get_password(service, account) is not None:
        raise RuntimeError("OS vault cleanup failed")
    backend = vault.get_keyring()
    print("PASS: write/read/delete temporary credential; " + type(backend).__module__ + "." + type(backend).__name__)


if __name__ == "__main__":
    probe()
