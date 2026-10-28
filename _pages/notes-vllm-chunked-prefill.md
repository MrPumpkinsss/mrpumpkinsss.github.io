---
layout: single
title: "Chunked Prefill"
permalink: /notes/vllm-chunked-prefill/
author_profile: true
---

<style>
  .srctable { width:100%; border-collapse:collapse; margin:10px 0; }
  .srctable th, .srctable td { border:1px solid #ddd; padding:7px 10px; font-size:0.88rem; text-align:left; vertical-align: top; }
  .srctable th { background:#f5f5f5; }
  html[data-theme="dark"] .srctable th { background:#303338; }
  html[data-theme="dark"] .srctable td { border-color:#444; }
  .tldr {
    border-left: 4px solid #e0a04a;
    background: #fff8ee;
    padding: 10px 16px;
    border-radius: 0 8px 8px 0;
    margin: 14px auto;
    max-width: 800px;
  }
  .tldr ul { margin: 6px 0 2px; padding-left: 20px; }
  .tldr li { margin-bottom: 5px; }
  html[data-theme="dark"] .tldr { background: #41321b; border-left-color: #d9a04b; }
  .diagram-fig { background:#fff; border:1px solid #ddd; border-radius:8px; padding:12px; margin:10px auto; max-width:860px; }
  .diagram-fig img { width:100%; height:auto; display:block; }
  html[data-theme="dark"] .diagram-fig { border-color:#444; }
</style>

<p>
  <a href="/notes/"><span class="i18n-zh">← 返回学习目录</span><span class="i18n-en">← Back to Study Catalog</span></a>
</p>

<div class="tldr">
  <strong><span class="i18n-zh">先记住四件事</span><span class="i18n-en">TL;DR</span></strong>
  <ul>
    <li><span class="i18n-zh">不切块时，一个 32K 的长 prompt 会把一步的 token 预算<strong>整个吃光</strong>：batch 里其他 decode 请求在这段时间完全停摆，token 间隔从 ~10ms 飙到数百 ms。</span></li>
    <li><span class="i18n-zh">chunked prefill：按「这一步最多算多少 token」的预算把长 prompt <strong>切成多段</strong>，每步算一段，并和 decode 请求<strong>混在同一个 batch</strong> 里跑。</span></li>
    <li><span class="i18n-zh">输出完全不变；被切的那个请求自己的<strong>首 token 时延反而变长</strong>（摊到多个 step）——换的是其他请求的时延平滑和更高的 GPU 利用率。V1 <strong>默认开启</strong>。</span></li>
    <li><span class="i18n-zh">切多少不是拍脑袋：五级 min 预算漏斗决定每段大小；Mamba 对齐、MTP lookahead 窗口等还会再修剪 chunk 边界；非最终 chunk <strong>这一步不产出采样 token</strong>。</span></li>
  </ul>
</div>

<h2 id="先统一几个词">
  <span class="i18n-zh">先统一几个词</span>
  <span class="i18n-en">Terms first</span>
</h2>

<table class="srctable">
  <tbody>
    <tr><td><strong>prefill（<span class="i18n-zh">预填充</span>）</strong></td><td><span class="i18n-zh">把整个 prompt 一次喂进模型：算完所有位置的 KV cache，产出第 1 个 token</span></td></tr>
    <tr><td><strong>decode（<span class="i18n-zh">解码</span>）</strong></td><td><span class="i18n-zh">拿着已算好的 KV，一个一个 token 往右生成</span></td></tr>
    <tr><td><strong>TTFT</strong></td><td>Time To First Token，<span class="i18n-zh">从发出请求到收到第一个 token 的时延</span></td></tr>
    <tr><td><strong>ITL</strong></td><td>Inter-Token Latency，<span class="i18n-zh">生成阶段相邻两个 token 之间的间隔</span></td></tr>
    <tr><td><strong>token budget</strong></td><td><span class="i18n-zh">一步最多喂给模型的 token 总数（<code>max_num_batched_tokens</code>）；切块就是按它的剩余量切的</span></td></tr>
    <tr><td><strong>chunk（<span class="i18n-zh">块/段</span>）</strong></td><td><span class="i18n-zh">长 prompt 被预算切出来的一段</span></td></tr>
    <tr><td><strong>FCFS</strong></td><td>First Come First Served，<span class="i18n-zh">先来先服务的调度顺序</span></td></tr>
    <tr><td><strong>KV cache</strong></td><td><span class="i18n-zh">模型为已算过的每个 token 缓存的注意力中间结果（详见「投机解码机制细节」页术语表）</span></td></tr>
  </tbody>
</table>

<h2 id="一句话定位">
  <span class="i18n-zh">它解决什么问题</span>
  <span class="i18n-en">What problem it solves</span>
</h2>

<p>
  <span class="i18n-zh"><strong>白话版</strong>：decode 中的请求每步只贡献 1 个 token，batch 很小；这时来了个 32K 的长 prompt。不切块的话，调度器只能二选一：要么让这 32K 独占好几个 step（其他请求干等），要么让长请求等别人（TTFT 无上限地涨）。chunked prefill 的答案是<strong>切成段、混着跑</strong>：每个 step = 「所有 decode 请求各 1 个 token + 长 prompt 的一段」，GPU 的 batch 始终是满的。</span>
</p>

<p>
  <span class="i18n-zh"><strong>源码版</strong>：V1 调度循环里 <code>token_budget = max_num_scheduled_tokens</code>、<code>input_budget = max_num_batched_tokens</code>（<code>scheduler.py:708-711</code>）；running 请求按序拿预算，一个长 prompt 一步吃不完就只调度一部分——剩下的留在请求上，下一步继续，这就是 chunk。vLLM V1 里 <code>enable_chunked_prefill</code> <strong>默认 True</strong>（<code>vllm/config/scheduler.py:134</code>）。</span>
</p>

<h2 id="机制细节">
  <span class="i18n-zh">机制细节：一步里发生了什么</span>
  <span class="i18n-en">Mechanics, step by step</span>
</h2>

<ol>
  <li><strong><span class="i18n-zh">算需求</span></strong>：<span class="i18n-zh">对 running 队列里的每个请求，<code>num_new_tokens = num_tokens_with_spec + 占位符 − num_computed_tokens</code>——它「还差多少没算」。</span></li>
  <li><strong><span class="i18n-zh">五级 min 漏斗</span></strong>：<span class="i18n-zh">这个数依次被五个上限削（见下图）：<span class="i18n-zh">剩余量 → long_prefill 上限 → token_budget → input_budget − 草稿槽位 → max_model_len 余量。</span>削完剩多少，这一步就算多少——<strong>切块就是这么自然发生的</strong>，没有单独的「切块开关逻辑」。</span></li>
  <li><strong><span class="i18n-zh">分配 KV 块</span></strong>：<span class="i18n-zh"><code>allocate_slots</code> 给这段 chunk 分块；显存不够就从最低优先级请求<strong>抢占</strong>（prefill 请求算到一半被抢，之后重算，不保留半成品 KV）。</span></li>
  <li><strong><span class="i18n-zh">混批执行</span></strong>：<span class="i18n-zh">这一步的 batch = 所有 decode 请求的 1 token + 若干 prefill chunk 的 token 段，一次前向同时算完。</span></li>
  <li><strong><span class="i18n-zh">非最终 chunk 不采样</span></strong>：<span class="i18n-zh">如果这段没到 prompt 末尾，这一步<strong>不产出 token</strong>（<code>_drafts_unused</code> 的 Case 1），请求标记 <code>is_prefill_chunk</code> 留在 running 队列等下一轮；投机解码的草稿提案此时也会被丢弃（验证不了）。</span></li>
  <li><strong><span class="i18n-zh">最终 chunk</span></strong>：<span class="i18n-zh">最后一段算完，正常采样出第 1 个 token，请求转入 decode。</span></li>
</ol>

<div class="diagram-fig">
  <img src="/files/diagrams/export/chunked-compare-d.svg" alt="不切块与切块的 GPU 时间线对比：不切块时长 prompt 独占 4 个 step、decode 干等；切块后每步都是 decode + 一段 chunk">
</div>

<h2 id="切多少">
  <span class="i18n-zh">切多少：五级 min 漏斗</span>
  <span class="i18n-en">The budget funnel</span>
</h2>

<div class="diagram-fig">
  <img src="/files/diagrams/export/chunked-flow-d.svg" alt="chunk 大小由五级 min 预算漏斗决定，以及一个 32K 请求的 chunk 生命周期">
</div>

<p>
  <span class="i18n-zh">几个容易忽略的修剪规则（都在 <code>scheduler.py</code>）：</span>
</p>

<ul>
  <li><strong>long_prefill 上限</strong>：<span class="i18n-zh"><code>long_prefill_token_threshold</code>（默认 0＝不设限）专门防「一个长 prompt 饿死别人」；<strong>批里只有一个请求时不生效</strong>（没人可饿，让它用满预算）。<code>_adaptive</code> 变体还会把上限的下限托到 <code>input_budget ÷ 请求数</code>。</span></li>
  <li><strong>Mamba 对齐</strong>：<span class="i18n-zh">混合注意力模型（含 Mamba 层）在 "align" 缓存模式下，chunk 必须结束在可缓存状态的块边界上（<code>_mamba_block_aligned_split</code>），否则中间段的状态没法复用。</span></li>
  <li><strong>MTP lookahead 窗口</strong>：<span class="i18n-zh">多模块 MTP 的起草器会在 prompt 尾部预读 <code>num_prefill_lookahead</code> 个位置——chunk 不允许结束在这个窗口内，否则起草器缺输入（EAGLE 系 lookahead=1，不受影响）。</span></li>
  <li><strong>FCFS 的弹性</strong>：<span class="i18n-zh">某段 chunk 因预算放不下时，调度器 <code>continue</code> 而非 <code>break</code>——允许后面的短请求先上，不严格死等队头。</span></li>
  <li><strong>pooling 模型例外</strong>：<span class="i18n-zh">embedding 类请求默认不切块，要显式开 <code>enable_chunked_prefill</code> 才行。</span></li>
</ul>

<h2 id="常见误区">
  <span class="i18n-zh">常见误区</span>
  <span class="i18n-en">Common misconceptions</span>
</h2>

<ul>
  <li><span class="i18n-zh"><strong>「chunked prefill 让 TTFT 更快」</strong>——对被切的那个请求恰恰相反：它的 prompt 摊在多个 step 上，TTFT 变长。它改善的是<strong>同 batch 其他请求的 ITL、排队公平性和整体吞吐</strong>。这是典型的「牺牲个体延迟换群体延迟分布」。</span></li>
  <li><span class="i18n-zh"><strong>「chunk 之间要保留半成品再续算」</strong>——在 GPU 侧不存在「半成品 KV 断点续算」：每个 chunk 的 KV 在它被调度的那个 step 算完就写进 cache，下一个 chunk 从 cache 里接着算，天然连续。需要断点的是 Mamba 这类带「整块状态」的模型，所以才要块对齐。</span></li>
  <li><span class="i18n-zh"><strong>「decode 和 prefill 混批会互相拖慢」</strong>——会互相影响计算时间（同一 batch 的 token 数变多），但远好于不混批时的完全停摆；Sarathi-Serve 论文的核心结论就是这个混批方式能在几乎不伤 decode 吞吐的情况下填满 GPU。</span></li>
</ul>

<h2 id="源码定位">
  <span class="i18n-zh">源码定位表（vllm/v1/core/sched/scheduler.py）</span>
  <span class="i18n-en">Source map</span>
</h2>

<table class="srctable">
  <thead><tr><th><span class="i18n-zh">机制</span></th><th><span class="i18n-zh">位置</span></th></tr></thead>
  <tbody>
    <tr><td><span class="i18n-zh">两个预算</span></td><td><code>token_budget = max_num_scheduled_tokens</code>、<code>input_budget = max_num_batched_tokens</code>（:708-711）</td></tr>
    <tr><td><span class="i18n-zh">五级 min 削减</span></td><td>running 循环 <code>num_new_tokens = min(...)</code>（:828-846）</td></tr>
    <tr><td><span class="i18n-zh">long_prefill 上限 + 自适应下限</span></td><td>:743-758；<code>long_prefill_token_threshold(_adaptive)</code></td></tr>
    <tr><td><span class="i18n-zh">非最终 chunk 不采样 / 丢草稿</span></td><td><code>_drafts_unused</code>（:491-533）</td></tr>
    <tr><td><span class="i18n-zh">Mamba 块对齐切分</span></td><td><code>_mamba_block_aligned_split</code>（:535-...）</td></tr>
    <tr><td><span class="i18n-zh">MTP lookahead 窗口修剪</span></td><td><code>_reserve_prefill_lookahead</code> 调用与注释（:673-681、:874-878）</td></tr>
    <tr><td><span class="i18n-zh">放不下时的弹性与抢占</span></td><td>continue 注释（:894-898）；<code>allocate_slots</code> 失败 → 抢占（:900-983）</td></tr>
    <tr><td><span class="i18n-zh">配置默认值</span></td><td><code>vllm/config/scheduler.py</code>：<code>enable_chunked_prefill=True</code>、<code>long_prefill_token_threshold=0</code></td></tr>
  </tbody>
</table>

<h2 id="学习路线">
  <span class="i18n-zh">学习路线</span>
  <span class="i18n-en">Learning path</span>
</h2>

<ol>
  <li><span class="i18n-zh">读 Sarathi-Serve 论文（OSDI 2024），理解「mixing chunks with decode」的原始动机与收益曲线。</span></li>
  <li><span class="i18n-zh">用一个 32K prompt + 若干短请求压测，对比 <code>--no-enable-chunked-prefill</code> 前后的 ITL / TTFT 分布。</span></li>
  <li><span class="i18n-zh">调 <code>--max-num-batched-tokens</code>（如 2048 / 8192 / 32768）观察 chunk 粒度与 TTFT/ITL 的权衡。</span></li>
  <li><span class="i18n-zh">读 <code>scheduler.py</code> 的 running 循环，跟一遍「五级 min」每一级在什么场景生效。</span></li>
</ol>

<p><em><span class="i18n-zh">基于 vLLM master @ 2026-10-28；调度行为以所在版本源码为准。</span></em></p>
