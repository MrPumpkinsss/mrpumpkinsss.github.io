---
layout: single
title: "SGLang"
permalink: /notes/sglang/
author_profile: true
---

<p>
  <a href="/notes/"><span class="i18n-zh">← 返回学习笔记</span><span class="i18n-en">← Back to Study Notes</span></a>
</p>

<div class="i18n-en">
  <p><em>English quick summary: SGLang is an LLM serving engine from the UC Berkeley LMSYS community, known for RadixAttention — a radix-tree KV cache that reuses arbitrary-length shared prefixes — plus an overlap scheduler that hides CPU scheduling behind GPU compute, first-party structured outputs, and EAGLE-family speculative decoding. The notes cover core mechanisms, architecture, common launch parameters, and a learning path. (Written in Chinese; headings are bilingual.)</em></p>
</div>

<h2 id="一句话定位">
  <span class="i18n-zh">一句话定位</span>
  <span class="i18n-en">What it is</span>
</h2>

<p>
  <span class="i18n-zh">SGLang 由 UC Berkeley 的 LMSYS 社区发展而来，以 <strong>RadixAttention</strong> 前缀复用和<strong>极低调度开销</strong>著称，在多轮对话、agent、few-shot、结构化输出这类「前缀共享密集」的负载上优势明显。</span>
</p>

<h2 id="核心机制">
  <span class="i18n-zh">核心机制</span>
  <span class="i18n-en">Core mechanisms</span>
</h2>

<ul>
  <li><strong>RadixAttention（NeurIPS 2024）</strong>：<span class="i18n-zh">用基数树（radix tree）管理 KV cache——请求的 prompt 插入树中，任意长度的公共前缀自动复用（比按 block 哈希匹配更细粒度）；配合 LRU + 引用计数驱逐；树上还能「分叉」，天然适配 beam search、self-consistency 与多轮会话。</span></li>
  <li><strong>Overlap scheduler（零开销调度）</strong>：<span class="i18n-zh">把下一步 batch 的 CPU 调度与本步 GPU 前向重叠，让调度开销基本被计算掩盖——decode 阶段 kernel 小、GPU 常常吃不饱，这一设计对吞吐影响显著。</span></li>
  <li><strong>结构化输出</strong>：<span class="i18n-zh">原生集成 xgrammar 等约束解码后端，JSON schema 输出又快又稳。</span></li>
  <li><strong>投机解码（speculative decoding）</strong>：<span class="i18n-zh">支持 EAGLE / EAGLE-2 / EAGLE-3 等 draft 模型方案及 ngram 等，是 EAGLE 系列落地最完善的引擎之一。</span></li>
  <li><strong>其他</strong>：<span class="i18n-zh">PD 分离（prefill/decode disaggregation）、torch.compile、FP8/INT4 量化、混合注意力结构模型支持等（演进很快，以官方文档为准）。</span></li>
</ul>

<h2 id="架构与源码入口">
  <span class="i18n-zh">架构与源码入口</span>
  <span class="i18n-en">Architecture &amp; source-code entry points</span>
</h2>

<ul>
  <li><code>python/sglang/srt/entrypoints/http_server.py</code>：<span class="i18n-zh">FastAPI 服务入口；<code>TokenizerManager</code> 负责分词与请求管理。</span></li>
  <li><code>managers/scheduler.py</code>：<span class="i18n-zh">每个 TP rank 一个 Scheduler 进程，事件循环 = 收请求 → 调度 batch → 前向 → 采样回包。</span></li>
  <li><code>layers/</code> 与 <code>model_executor/model_runner.py</code>：<span class="i18n-zh">模型执行层。</span></li>
  <li><code>mem_cache/</code>：<span class="i18n-zh">radix cache 与 token pool 的实现（RadixAttention 的家）。</span></li>
</ul>

<h2 id="上手与常用参数">
  <span class="i18n-zh">上手与常用参数</span>
  <span class="i18n-en">Getting started &amp; common parameters</span>
</h2>

```bash
pip install "sglang[all]"
# 启动 OpenAI 兼容服务
python -m sglang.launch_server --model-path Qwen/Qwen2.5-7B-Instruct --tp 2 --mem-fraction-static 0.85
```

| <span class="i18n-zh">参数</span><span class="i18n-en">Parameter</span> | <span class="i18n-zh">作用</span><span class="i18n-en">Effect</span> |
| --- | --- |
| `--tp` / `--dp` | <span class="i18n-zh">张量并行 / 数据并行</span><span class="i18n-en">Tensor / data parallelism</span> |
| `--mem-fraction-static` | <span class="i18n-zh">静态显存占比（决定 KV cache pool 大小）</span><span class="i18n-en">Static memory fraction (sizes the KV cache pool)</span> |
| `--context-length` | <span class="i18n-zh">覆盖模型默认上下文长度</span><span class="i18n-en">Override the model's default context length</span> |
| `--enable-torch-compile` | <span class="i18n-zh">用 torch.compile 优化 decode</span><span class="i18n-en">Optimize decode with torch.compile</span> |
| `--speculative-algorithm` | <span class="i18n-zh">投机解码算法（如 EAGLE）</span><span class="i18n-en">Speculative decoding algorithm (e.g. EAGLE)</span> |

<h2 id="学习路线">
  <span class="i18n-zh">学习路线</span>
  <span class="i18n-en">Learning path</span>
</h2>

<ol>
  <li><span class="i18n-zh">读 RadixAttention 论文（SGLang，NeurIPS 2024）。</span></li>
  <li><span class="i18n-zh">跑通 launch_server，用多轮对话日志观察 radix cache 命中率（cache hit rate）。</span></li>
  <li><span class="i18n-zh">读 overlap scheduler 的实现，理解「调度与计算重叠」如何做到。</span></li>
  <li><span class="i18n-zh">与 vLLM 在同一负载下对比吞吐/时延，体会两者调度与缓存策略的差异。</span></li>
  <li><span class="i18n-zh">进阶：改一个缓存驱逐策略，或接一个新 draft 模型。</span></li>
</ol>

<h2 id="论文与资料">
  <span class="i18n-zh">论文与资料</span>
  <span class="i18n-en">Papers &amp; resources</span>
</h2>

<ul>
  <li><em>SGLang: Efficient Execution of Structured Language Model Programs with Frontier Model Access</em>（NeurIPS 2024）</li>
  <li><span class="i18n-zh">官方文档：</span>docs.sglang.ai</li>
  <li><span class="i18n-zh">仓库内 benchmark 脚本（<code>benchmark/</code>）非常适合做引擎对比实验。</span></li>
</ul>

<p><em><span class="i18n-zh">更新于 2026-10；引擎迭代快，具体行为以官方文档为准。</span></em></p>
