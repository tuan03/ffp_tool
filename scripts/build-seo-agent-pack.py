"""Build only explicitly allowed public files, never runtime configs or tokens."""
import hashlib
import pathlib
import zipfile

root = pathlib.Path(__file__).resolve().parent.parent
source = root / "tools" / "seo-agent-pack"
destination = root / "dist" / "seo-agent-pack"
destination.mkdir(parents=True, exist_ok=True)
archive = destination / "ffp-seo-worker-1.0.0-preview.zip"
with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
    for name in ["ffp_worker.py", "test_vault_live.py", "requirements.txt", "README.md", "skill/SKILL.md"]:
        path = source / name
        if path.is_symlink():
            raise RuntimeError("Refusing symlink pack input")
        bundle.write(path, name)
checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
archive.with_suffix(".zip.sha256").write_text(checksum + "  " + archive.name + "\n", encoding="ascii")
print(archive)
print(checksum)
