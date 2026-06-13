"""Paddle PaddleOCR-VL-1.6 test — layout parsing + markdown 表格，读 .env 的 PADDLE_API_KEY。"""
import json
import os
import sys
import time

import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

JOB_URL = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs"
TOKEN = os.environ["PADDLE_API_KEY"]
MODEL = "PaddleOCR-VL-1.6"

file_path = sys.argv[1] if len(sys.argv) > 1 else "../pdf/GBT 23457-2017 预铺防水卷材.pdf"
out_md = sys.argv[2] if len(sys.argv) > 2 else "paddle_vl_result.md"

headers = {"Authorization": f"bearer {TOKEN}"}
optional_payload = {
    "useDocOrientationClassify": False,
    "useDocUnwarping": False,
    "useChartRecognition": False,
}

print(f"[paddle-vl] processing: {file_path}")
t0 = time.time()

if file_path.startswith("http"):
    headers["Content-Type"] = "application/json"
    payload = {"fileUrl": file_path, "model": MODEL, "optionalPayload": optional_payload}
    job_response = requests.post(JOB_URL, json=payload, headers=headers)
else:
    if not os.path.exists(file_path):
        print(f"Error: File not found at {file_path}")
        sys.exit(1)
    data = {"model": MODEL, "optionalPayload": json.dumps(optional_payload)}
    with open(file_path, "rb") as f:
        files = {"file": f}
        job_response = requests.post(JOB_URL, headers=headers, data=data, files=files)

print(f"[paddle-vl] submit status: {job_response.status_code}")
if job_response.status_code != 200:
    print(f"[paddle-vl] response: {job_response.text}")
job_response.raise_for_status()

jobId = job_response.json()["data"]["jobId"]
print(f"[paddle-vl] job id: {jobId}, polling...")

jsonl_url = ""
while True:
    r = requests.get(f"{JOB_URL}/{jobId}", headers=headers)
    r.raise_for_status()
    d = r.json()["data"]
    state = d["state"]
    if state == "pending":
        print("[paddle-vl] pending")
    elif state == "running":
        prog = d.get("extractProgress", {})
        print(f"[paddle-vl] running, {prog.get('extractedPages','?')}/{prog.get('totalPages','?')} pages")
    elif state == "done":
        prog = d["extractProgress"]
        print(f"[paddle-vl] done, pages={prog['extractedPages']}")
        jsonl_url = d["resultUrl"]["jsonUrl"]
        break
    elif state == "failed":
        print(f"[paddle-vl] FAILED: {d['errorMsg']}")
        sys.exit(1)
    time.sleep(5)

jr = requests.get(jsonl_url)
jr.raise_for_status()
pages_md = []
for line in jr.text.strip().split("\n"):
    line = line.strip()
    if not line:
        continue
    result = json.loads(line)["result"]
    for res in result["layoutParsingResults"]:
        pages_md.append(res["markdown"]["text"])

full = "\n\n---\n\n".join(pages_md)
with open(out_md, "w") as f:
    f.write(full)

dt = time.time() - t0
print(f"[paddle-vl] wrote {out_md}: {len(full)} chars, {len(pages_md)} pages, {dt:.1f}s")
