# OCR 改用托管 PaddleOCR-VL API，废止本地 pdftoppm 渲染

扫描件转 markdown 改用 PaddleOCR-VL-1.6（`paddleocr.aistudio-app.com` 托管 API，独立 `PADDLE_API_KEY`），直接上传 PDF 拿结果，**废止 [ADR-0002](0002-preprocessing-ts-pdftoppm.md) 的「pdftoppm 渲染 PNG → Vision OCR」整条管线**。本地不再渲染，poppler 依赖也随之去掉。

权衡：对同一份现行标准（GB/T 23457—2017，扫描件）实测对比了 PaddleOCR-VL、Mistral OCR、PP-OCRv5 三家——

- **文字准确度**：PaddleOCR-VL 最高（「范围/面/拉伸」全对，Mistral 误成「氚围/而/括伸」）。
- **指标表格**：PaddleOCR-VL 输出带 `rowspan/colspan` 的 HTML 表格，把「拉伸性能跨 5 行、P/PY/R 跨 3 列」这种合并单元格原样保留；Mistral 拍平成 markdown 会丢合并信息；PP-OCRv5 直接把表格打散成逐格散行，不可用。
- **速度**：PaddleOCR-VL ~30s/份，Mistral ~5s/份。本项目是一次性离线入库（约 18 份），速度无所谓，**指标表格的准确度才是命门**——错字会直接污染检索与作答。

代价：HTML 表格比 markdown 更占 token（VL 总体积约为 Mistral 两倍，多出来的全是标签）。后人若担心 chunk 体积想把 HTML 转 markdown，须先验证合并单元格拍平后指标值不会错位——否则宁可保留 HTML。对比脚本与三家结果留在 `ocr_compare/`。
