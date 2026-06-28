from pathlib import Path
import unittest


class ReadmeTest(unittest.TestCase):
    def test_includes_hello_world_line(self):
        readme = Path(__file__).resolve().parents[1] / "README.md"

        self.assertIn("hello world", readme.read_text().splitlines())


if __name__ == "__main__":
    unittest.main()
