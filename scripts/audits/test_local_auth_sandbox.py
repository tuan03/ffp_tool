"""Windows status readers must not terminate the isolated sandbox supervisor."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from local_auth_sandbox import write_json


class SandboxStatusTests(unittest.TestCase):
    def test_retries_transient_windows_reader_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "status.json"
            original = Path.replace
            attempts = []
            def replace(source, target):
                attempts.append(target)
                if len(attempts) < 3:
                    raise PermissionError("Reader temporarily holds the destination")
                return original(source, target)
            with patch.object(Path, "replace", replace):
                write_json(path, {"state": "running"})
            self.assertEqual(json.loads(path.read_text()), {"state": "running"})
            self.assertEqual(len(attempts), 3)


if __name__ == "__main__":
    unittest.main()
