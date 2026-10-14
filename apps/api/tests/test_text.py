from fastapi.testclient import TestClient

from app.main import app
from app.text import clean_text

client = TestClient(app)


def test_clean_text_trims_lines_and_collapses_blank_lines():
    raw = "  Mitosis  \r\n\r\n\r\n  Cell division \n\n\n"
    assert clean_text(raw) == "Mitosis\n\nCell division"


def test_read_text():
    response = client.post("/api/text", json={"text": "  The mitochondria\n\nis the powerhouse "})
    assert response.status_code == 200
    body = response.json()
    assert body["text"] == "The mitochondria\n\nis the powerhouse"
    assert body["word_count"] == 5


def test_read_text_rejects_empty():
    response = client.post("/api/text", json={"text": "   \n  "})
    assert response.status_code == 400
