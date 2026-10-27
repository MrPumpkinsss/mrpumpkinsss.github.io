---
layout: single
title: "vLLM"
permalink: /notes/vllm/
author_profile: true
---

<p>
  <a href="/notes/"><span class="i18n-zh">← 返回学习笔记</span><span class="i18n-en">← Back to Study Notes</span></a>
</p>

<div class="i18n-en">
  <p><em>English quick summary: vLLM is a high-throughput LLM serving engine built around PagedAttention — a paged, block-level KV cache manager — combined with continuous batching, automatic prefix caching, chunked prefill, and built-in speculative decoding. The notes below cover the core mechanisms, the V1 engine architecture, common launch parameters, and a learning path. (The notes are written in Chinese; headings are bilingual.)</em></p>
</div>

<h2 id="一句话定位">
  <span class="i18n-zh">一句话定位</span>
  <span class="i18n-en">What it is</span>
</h2>

<p>
  <span class="i18n-zh">vLLM 由 UC Berkeley 开源，凭借 <strong>PagedAttention</strong> 一战成名，是目前工业界应用最广的开源 LLM 推理引擎之一，主打高吞吐服务（throughput-oriented serving）。</span>
</p>

<h2 id="核心机制">
  <span class="i18n-zh">核心机制</span>
  <span class="i18n-en">Core mechanisms</span>
</h2>

<ul>
  <li><strong>PagedAttention（SOSP 2023）</strong>：<span class="i18n-zh">把 KV cache 切成固定大小的 block（典型 16 token/块），用「逻辑块 → 物理块」映射表分页管理、按需分配，几乎消灭显存碎片（论文数据：KV 显存浪费从 60–80% 降到 4% 以下）；序列之间相同前缀通过 copy-on-write 共享物理块。</span></li>
  <li><strong>Continuous batching（连续批处理）</strong>：<span class="i18n-zh">调度粒度是引擎的每一步（iteration 级）而非整个请求生命周期：请求随到随进批、做完立刻退出、空位马上补新请求。思路源自 Orca，被 vLLM 发扬光大。</span></li>
  <li><strong>Automatic Prefix Caching（APC，前缀缓存）</strong>：<span class="i18n-zh">对每个 KV block 按内容哈希，相同前缀的请求直接复用已算好的 KV；多轮对话、few-shot、共享 system prompt 场景可省掉大量重复 prefill（新版本默认开启）。</span></li>
  <li><strong>Chunked prefill（分块预填充）</strong>：<span class="i18n-zh">把超长 prompt 的 prefill 切成多个 chunk，与 decode 混在同一批执行，避免一个长请求阻塞其他请求的时延。</span></li>
  <li><strong>投机解码（speculative decoding）</strong>：<span class="i18n-zh">内置 ngram、draft model、Medusa、EAGLE 等多种方案，也支持与结构化输出结合的投机执行。</span></li>
  <li><strong>量化与并行</strong>：<span class="i18n-zh">FP8/INT8/AWQ/GPTQ 等量化方案；TP/PP/EP 多卡并行等（版本迭代很快，以官方文档为准）。</span></li>
</ul>

<h2 id="架构与源码入口-v1-引擎">
  <span class="i18n-zh">架构与源码入口（V1 引擎）</span>
  <span class="i18n-en">Architecture &amp; source-code entry points (V1 engine)</span>
</h2>

<ul>
  <li><code>AsyncLLM</code>：<span class="i18n-zh">异步 API 层，对接 OpenAI 兼容 server。</span></li>
  <li><code>EngineCore</code>：<span class="i18n-zh">独立引擎进程，主循环 = schedule → execute → update。</span></li>
  <li><code>Scheduler</code>（<code>vllm/v1/core/sched/</code>）：<span class="i18n-zh">每步决定哪些请求进批、分配/回收哪些 block，是理解调度行为的核心。</span></li>
  <li><code>Executor / Worker / ModelRunner</code>：<span class="i18n-zh">多进程（multiproc/Ray）执行；GPU 侧负责前向、采样与 CUDA Graph 捕获。</span></li>
  <li><code>vllm/entrypoints/openai/</code>：<span class="i18n-zh">OpenAI 兼容 API server 的实现。</span></li>
</ul>

<h2 id="上手与常用参数">
  <span class="i18n-zh">上手与常用参数</span>
  <span class="i18n-en">Getting started &amp; common parameters</span>
</h2>

```bash
pip install vllm
# 启动 OpenAI 兼容服务
vllm serve Qwen/Qwen2.5-7B-Instruct --tensor-parallel-size 2 --max-model-len 32768
# 压测（新版本）：vllm bench serve；旧版本用仓库内 benchmarks/benchmark_serving.py
```

| <span class="i18n-zh">参数</span><span class="i18n-en">Parameter</span> | <span class="i18n-zh">作用</span><span class="i18n-en">Effect</span> |
| --- | --- |
| `--tensor-parallel-size` | <span class="i18n-zh">张量并行卡数</span><span class="i18n-en">Tensor-parallel degree</span> |
| `--gpu-memory-utilization` | <span class="i18n-zh">显存占用上限（KV cache 预算由此而来）</span><span class="i18n-en">GPU memory cap (determines the KV cache budget)</span> |
| `--max-model-len` | <span class="i18n-zh">最大上下文长度</span><span class="i18n-en">Maximum context length</span> |
| `--max-num-seqs` | <span class="i18n-zh">最大并发序列数</span><span class="i18n-en">Maximum concurrent sequences</span> |
| `--enable-prefix-caching` | <span class="i18n-zh">打开前缀缓存（新版本默认开启）</span><span class="i18n-en">Enable prefix caching (on by default in recent versions)</span> |
| `--speculative-config` | <span class="i18n-zh">投机解码配置（方法/草稿模型/步长等）</span><span class="i18n-en">Speculative decoding config (method/drafter/steps)</span> |

<h2 id="学习路线">
  <span class="i18n-zh">学习路线</span>
  <span class="i18n-en">Learning path</span>
</h2>

<ol>
  <li><span class="i18n-zh">精读 PagedAttention 论文（SOSP 2023），吃透 block 化 KV 管理。</span></li>
  <li><span class="i18n-zh">本地跑通 serve + 压测，观察 TTFT / ITL / 吞吐的相互制约。</span></li>
  <li><span class="i18n-zh">读 <code>vllm/v1/core/sched/</code> 调度器源码，跟一遍「一个请求的一生」。</span></li>
  <li><span class="i18n-zh">开关 APC / chunked prefill / 投机解码做对照实验。</span></li>
  <li><span class="i18n-zh">进阶：改一个调度策略，或接一个自定义 draft 模型。</span></li>
</ol>

<h2 id="论文与资料">
  <span class="i18n-zh">论文与资料</span>
  <span class="i18n-en">Papers &amp; resources</span>
</h2>

<ul>
  <li><em>Efficient Memory Management for Large Language Model Serving with PagedAttention</em>（SOSP 2023）</li>
  <li><span class="i18n-zh">vLLM V1 架构官方博客（2025）：引擎进程化、异步调度等</span></li>
  <li><span class="i18n-zh">官方文档：</span>docs.vllm.ai</li>
</ul>

<p><em><span class="i18n-zh">更新于 2026-10；引擎迭代快，具体行为以官方文档为准。</span></em></p>
