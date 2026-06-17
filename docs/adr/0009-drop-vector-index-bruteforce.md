# 去 DiskANN 向量索引，检索改 vector_distance_cos 暴力扫

## 状态

已采纳（2026-06-17）。**细化**硬约束②（检索 = 向量 + BM25 混合）——「向量」那一路的实现从
DiskANN ANN 索引（`vector_top_k`）换成全表线性扫（`vector_distance_cos`）。混合检索本身不变。

## 背景

入库 upsert 写远程 Turso（us-west-2）极慢：实测一篇 187 块从国内 CLI 直写要 ~233s，而写本地
`turso dev` 仅 ~3s。逐层隔离实验（同一篇、缓存 OCR、只换落库目标）定位根因：**不是网络往返**，
而是远程 Turso 服务端「逐个向量插进 DiskANN 图」那步——每条 insert 要更新索引 shadow 表，远程约
1.25s/条，本地仅 16ms/条。试过用 `client.batch` 一个往返发完，但整批塞进一个大事务做 187 次
DiskANN 插入反而**卡死**（>390s 未返回），故放弃 batch。

转而审视索引本身：全库才 **~1700 向量**。调研（Turso 官方 + 实测）：

- 暴力扫 `vector_distance_cos` 在本地 1801 向量上 ~10ms/次；线上两种查法都被建连/网络（~840ms）淹没，
  索引**零可测提速**。Turso 文档：暴力扫在 40 万向量都才 269–448ms，ANN 是给「较大数据集」的。
- 暴力扫 top-8 与 `vector_top_k` top-8 **结果逐条一致**（这个规模 ANN 的近似 = 精确）。
- DiskANN 存储膨胀大（官方：3 万条 1024 维原始 117 MiB → 索引 ~5 GiB；本项目本地库曾因此涨到 595M）。
- 建索引在 Turso 上还踩过一堆坑（满表事后 CREATE INDEX 注册不成、写锁卡死连 destroy 都做不了）。

## 决策

**去掉 DiskANN 向量索引，向量召回改全表 `vector_distance_cos` 线性扫。**

- 新增 `corpus.vectorSearchIds(queryVector, topK)`：`SELECT vector_id FROM standards ORDER BY
  vector_distance_cos(embedding, vector32(?)) LIMIT ?`，返回按相似度排序的 top-K id。
- `retrieve.hybridSearch` 弃 Mastra `vector_top_k`，去掉注入的 `vectorStore` 参数，直接调 `vectorSearchIds`。
- `ingest-pipeline`：`ensureIndex` → `ensureTable`（`CREATE TABLE IF NOT EXISTS`，不再建向量索引）。
- 线上 + 本地库 `DROP INDEX standards_vector_idx`（数据行不动，只删索引图）。

混合检索的另两路（BM25 关键词、元数据内存过滤）与 RRF 融合**完全不变**。

## 验证

删索引前后跑 `test/eval.ts`（连线上库）：

- 召回·裸(指标) 36/36 = **100%** = 基线；召回·正文 `--prose` 28/32 = **87.5%** = 基线。**零退化。**
- 线上 upsert 246s → **70s**（不再逐向量建图；剩余是 Mastra 逐条 execute 的 187 次跨洋往返）。
- 84 单测通过。

## 代价 / 已知风险

- **规模上限**：暴力扫是 O(n)。当前 1700 向量无感；涨到 ~10 万+ 量级会变慢，届时需加回 ANN 索引
  （`CREATE INDEX ... libsql_vector_idx`，并把 `vectorSearchIds` 切回 `vector_top_k`）。
- 写入仍有提速空间：去索引后 `client.batch` 不会再因 DiskANN 大事务卡死，可进一步把 187 次往返压成 1 次；
  但 70s 对后台 Workflow 入库够用，暂不做。
- `状态`/元数据等不受影响；表结构保留 `vector_id UNIQUE` 供 upsert 幂等覆盖。
