"""Mistral OCR test — 读 .env 里的 MISTRAL_API_KEY，上传 PDF 走 ocr.process。"""
import os
import sys
import time

from dotenv import load_dotenv
from mistralai import Mistral

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

file_path = sys.argv[1] if len(sys.argv) > 1 else "../pdf/GBT 23457-2017 预铺防水卷材.pdf"
out_md = sys.argv[2] if len(sys.argv) > 2 else "mistral_result.md"

client = Mistral(api_key=os.environ["MISTRAL_API_KEY"])

print(f"[mistral] processing: {file_path}")
t0 = time.time()

with open(file_path, "rb") as f:
    uploaded = client.files.upload(
        file={"file_name": os.path.basename(file_path), "content": f},
        purpose="ocr",
    )
print(f"[mistral] uploaded file id: {uploaded.id}")

signed = client.files.get_signed_url(file_id=uploaded.id)
resp = client.ocr.process(
    model="mistral-ocr-latest",
    document={"type": "document_url", "document_url": signed.url},
    include_image_base64=False,
)

pages_md = [p.markdown for p in resp.pages]
full = "\n\n---\n\n".join(pages_md)
with open(out_md, "w") as f:
    f.write(full)

dt = time.time() - t0
print(f"[mistral] wrote {out_md}: {len(full)} chars, {len(pages_md)} pages, {dt:.1f}s")
