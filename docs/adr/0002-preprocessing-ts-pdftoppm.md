# 扫描件预处理用全 TS + pdftoppm，而非 Python

> **状态：已废止（Superseded）→ 见 [ADR-0003](0003-ocr-paddleocr-vl.md)。**
> OCR 改用托管的 PaddleOCR-VL API，直接吃 PDF，不再本地渲染，下面整段权衡随之作废。原文保留以留存「当初为什么选 pdftoppm」的推理。

---

"PDF→图片→OCR→markdown"这段离线预处理，我们用 TypeScript `spawn` 调用 poppler 的 `pdftoppm` 命令行把扫描件渲染成 PNG，再喂给 Vision OCR；**没有**按常识引入 Python（pdf2image 等）。

权衡：Python 的 PDF 渲染生态确实更成熟，但会让本就是 Mastra(TS) 的项目背上双语言栈、双依赖管理。Node 原生 PDF 渲染库（pdf.js/unpdf）在高 DPI 扫描件上质量不可控，所以也排除。`pdftoppm` 子进程取了中间路：渲染质量靠成熟的 poppler 保证（`brew install poppler`），运行时仍是单一 TS。后人若想"重写成 Python 统一渲染"，请先权衡双语言栈的代价。
