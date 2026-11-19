"""Rebuild index.html from src/ (inlines engine.js and questions.js into template.html)."""
from pathlib import Path

root = Path(__file__).parent
src = root / "src"
engine = (src / "engine.js").read_text(encoding="utf-8").replace(
    "if (typeof module !== 'undefined') module.exports = VE;", "")
questions = (src / "questions.js").read_text(encoding="utf-8").replace(
    "if (typeof module !== 'undefined') module.exports = QUESTIONS;", "")
page = (src / "template.html").read_text(encoding="utf-8")
page = page.replace("/*__ENGINE__*/", engine).replace("/*__QUESTIONS__*/", questions)
(root / "index.html").write_text(page, encoding="utf-8")
print("index.html written")
