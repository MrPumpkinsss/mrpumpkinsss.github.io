---
layout: single
title: "PP Interleaving"
permalink: /notes/vllm-pp/
author_profile: true
---

<style>
  .dg { width: 100%; height: auto; display: block; margin: 8px 0 2px; }
  .dg .b  { fill: #eef3fd; stroke: #7a97d4; stroke-width: 1.2; }
  .dg .ba { fill: #fff3e0; stroke: #e0a04a; stroke-width: 1.4; }
  .dg .bg { fill: #e9f6ee; stroke: #59a97c; stroke-width: 1.2; }
  .dg .bb { fill: #f2f2f4; stroke: #b9bcc4; stroke-width: 1; }
  .dg text { fill: #333; font-family: inherit; }
  .dg .ts { fill: #666; }
  .dg .ln { stroke: #7a879d; stroke-width: 1.4; fill: none; }
  .dg .arrp { fill: #7a879d; }
  html[data-theme="dark"] .dg .b  { fill: #2b3550; stroke: #6f8cc9; }
  html[data-theme="dark"] .dg .ba { fill: #41321b; stroke: #d9a04b; }
  html[data-theme="dark"] .dg .bg { fill: #1f3a2a; stroke: #5cb987; }
  html[data-theme="dark"] .dg .bb { fill: #2c2f36; stroke: #565b66; }
  html[data-theme="dark"] .dg text { fill: #ddd; }
  html[data-theme="dark"] .dg .ts { fill: #999; }
  html[data-theme="dark"] .dg .ln { stroke: #8a97ad; }
  html[data-theme="dark"] .dg .arrp { fill: #8a97ad; }
  .srctable { width:100%; border-collapse:collapse; margin:10px 0; }
  .srctable th, .srctable td { border:1px solid #ddd; padding:7px 10px; font-size:0.88rem; text-align:left; }
  .srctable th { background:#f5f5f5; }
  html[data-theme="dark"] .srctable th { background:#303338; }
  html[data-theme="dark"] .srctable td { border-color:#444; }
</style>

<p>
  <a href="/notes/"><span class="i18n-zh">← 返回学习目录</span><span class="i18n-en">← Back to Study Catalog</span></a>
</p>

<div class="i18n-en">
  <p><em>English quick summary: how vLLM V1 pipelines execution under pipeline parallelism — layers are split into contiguous per-rank stages, and an engine-level batch queue keeps <strong>pp_size (+1 with async scheduling and Model Runner V2)</strong> steps in flight so stages interleave different steps' microbatches. Includes the decode_stagger ring cadence, the two sampled-token return paths, and what vLLM does NOT do (no Megatron-style virtual-stage interleaving). (Written in Chinese; based on vLLM master @ 2026-10-28.)</em></p>
</div>

<h2 id="一句话定位">
  <span class="i18n-zh">一句话定位</span>
  <span class="i18n-en">What it is</span>
</h2>

<p>
  <span class="i18n-zh">vLLM V1 的 PP（<code>--pipeline-parallel-size</code>）不是 Megatron 式的「一个 batch 切微批、1F1B 交错」，而是<strong>引擎级多 step 在飞</strong>：<code>EngineCore</code> 维护一个 batch queue，同时塞进 <code>pp_size</code>（异步调度 + MRv2 下 <code>pp_size+1</code>）个已调度但未出结果的 step；流水线各级在同一时刻处理<strong>不同 step 的批</strong>，让每个 stage 都有活干。交错发生在<strong>step 之间</strong>，同一个 step 内请求的层永远是连续切段。</span>
</p>

<h2 id="静态切分">
  <span class="i18n-zh">静态切层：连续、均匀、配平</span>
  <span class="i18n-en">Static layer partitioning</span>
</h2>

<p>
  <span class="i18n-zh"><code>get_pp_indices</code>（<code>vllm/distributed/utils.py</code>）把 <code>num_hidden_layers</code> <strong>连续均匀</strong>地分给各 rank：除不尽的余量优先摊给中间段——首段有 embedding、末段有 lm_head + norm，刻意给这两段少配一层来平衡各 stage 的峰值显存。想手动控制每段层数，用环境变量 <code>VLLM_PP_LAYER_PARTITION="20,20,20,20"</code> 指定（长度必须等于 pp_size、总和必须等于层数）。<strong>没有虚拟级 / 交错切分</strong>：一个请求的层在物理上不会被拆成两个 stage 交替执行。</span>
</p>

<h2 id="一步的执行">
  <span class="i18n-zh">一步的执行：从调度到最后一级采样</span>
  <span class="i18n-en">One step, end to end</span>
</h2>

<ul>
  <li><span class="i18n-zh">调度器只在引擎核心进程跑一次，产出 <code>SchedulerOutput</code>；Executor 通过 <code>rpc_broadcast_mq</code>（共享内存 MessageQueue）把它<strong>广播给所有 PP rank 的 worker</strong>（<code>multiproc_executor.py</code>）。</span></li>
  <li><span class="i18n-zh">Stage 0 执行自己的层段，把 <code>intermediate_tensors</code> 通过进程组 P2P 交给 stage 1，逐级传递（<code>gpu_model_runner.py: execute_model(..., intermediate_tensors)</code>）。</span></li>
  <li><span class="i18n-zh">最后一级做采样，<code>ModelRunnerOutput</code> 沿 executor 回到引擎核心。<code>external_launcher</code>（torchrun）后端是特例：跨 PP rank 用 GPU broadcast 同步采样输出（<code>broadcast_pp_output</code>）。</span></li>
</ul>

<h2 id="在飞深度">
  <span class="i18n-zh">在飞深度：batch queue 才是流水线的「油」</span>
  <span class="i18n-en">In-flight depth: the batch queue</span>
</h2>

<p>
  <span class="i18n-zh">配置里最说明问题的一段注释（<code>VllmConfig.max_concurrent_batches</code>）：<strong>「PP requires PP-size concurrent batches to fill the pipeline. Async scheduling requires 2 concurrent batches to overlap.」</strong>取值规则：<code>PP&gt;1</code> → <code>pp_size</code>；再加异步调度且用 MRv2 → <code>pp_size+1</code>（多出的 1 个用来在调度侧预备下一步）。EngineCore 的 <code>step_with_batch_queue</code> 用一个 deque 装「已调度、未出结果」的 step：队列没满就继续 <code>schedule() → execute_model(non_block=True)</code>，满了才按 FIFO 等最早的 step 出结果。稳态下 4 级流水就是 4 个 step 同时在流水线里错位前进：</span>
</p>

<svg class="dg" viewBox="0 0 860 330" role="img" aria-label="PP 流水线在飞 step 时空图">
  <text x="16" y="22" font-size="12" class="ts">时间 →</text>
  <text x="16" y="40" font-size="12" class="ts">（每个 stage 每格处理一个 step）</text>
  <rect x="100" y="36" width="66" height="42" rx="6" class="b"/><text x="133" y="62" text-anchor="middle" font-size="12">T0</text>
  <rect x="190" y="36" width="66" height="42" rx="6" class="ba"/><text x="223" y="62" text-anchor="middle" font-size="12">T1</text>
  <rect x="280" y="36" width="66" height="42" rx="6" class="bg"/><text x="313" y="62" text-anchor="middle" font-size="12">T2</text>
  <rect x="370" y="36" width="66" height="42" rx="6" class="bb"/><text x="403" y="62" text-anchor="middle" font-size="12">T3</text>
  <rect x="460" y="36" width="66" height="42" rx="6" class="b"/><text x="493" y="62" text-anchor="middle" font-size="12">T4</text>
  <rect x="550" y="36" width="66" height="42" rx="6" class="ba"/><text x="583" y="62" text-anchor="middle" font-size="12">T5</text>
  <rect x="145" y="96" width="66" height="42" rx="6" class="b"/><text x="178" y="122" text-anchor="middle" font-size="12">T0</text>
  <rect x="235" y="96" width="66" height="42" rx="6" class="ba"/><text x="268" y="122" text-anchor="middle" font-size="12">T1</text>
  <rect x="325" y="96" width="66" height="42" rx="6" class="bg"/><text x="358" y="122" text-anchor="middle" font-size="12">T2</text>
  <rect x="415" y="96" width="66" height="42" rx="6" class="bb"/><text x="448" y="122" text-anchor="middle" font-size="12">T3</text>
  <rect x="505" y="96" width="66" height="42" rx="6" class="b"/><text x="538" y="122" text-anchor="middle" font-size="12">T4</text>
  <rect x="595" y="96" width="66" height="42" rx="6" class="ba"/><text x="628" y="122" text-anchor="middle" font-size="12">T5</text>
  <rect x="190" y="156" width="66" height="42" rx="6" class="b"/><text x="223" y="182" text-anchor="middle" font-size="12">T0</text>
  <rect x="280" y="156" width="66" height="42" rx="6" class="ba"/><text x="313" y="182" text-anchor="middle" font-size="12">T1</text>
  <rect x="370" y="156" width="66" height="42" rx="6" class="bg"/><text x="403" y="182" text-anchor="middle" font-size="12">T2</text>
  <rect x="460" y="156" width="66" height="42" rx="6" class="bb"/><text x="493" y="182" text-anchor="middle" font-size="12">T3</text>
  <rect x="550" y="156" width="66" height="42" rx="6" class="b"/><text x="583" y="182" text-anchor="middle" font-size="12">T4</text>
  <rect x="640" y="156" width="66" height="42" rx="6" class="ba"/><text x="673" y="182" text-anchor="middle" font-size="12">T5</text>
  <rect x="235" y="216" width="66" height="42" rx="6" class="b"/><text x="268" y="242" text-anchor="middle" font-size="12">T0</text>
  <rect x="325" y="216" width="66" height="42" rx="6" class="ba"/><text x="358" y="242" text-anchor="middle" font-size="12">T1</text>
  <rect x="415" y="216" width="66" height="42" rx="6" class="bg"/><text x="448" y="242" text-anchor="middle" font-size="12">T2</text>
  <rect x="505" y="216" width="66" height="42" rx="6" class="bb"/><text x="538" y="242" text-anchor="middle" font-size="12">T3</text>
  <rect x="595" y="216" width="66" height="42" rx="6" class="b"/><text x="628" y="242" text-anchor="middle" font-size="12">T4</text>
  <rect x="685" y="216" width="66" height="42" rx="6" class="ba"/><text x="718" y="242" text-anchor="middle" font-size="12">T5</text>
  <text x="16" y="62" font-size="12">stage 0</text>
  <text x="16" y="122" font-size="12">stage 1</text>
  <text x="16" y="182" font-size="12">stage 2</text>
  <text x="16" y="242" font-size="12">stage 3</text>
  <line x1="100" y1="86" x2="770" y2="86" class="ln" stroke-dasharray="3 3"/>
  <line x1="100" y1="146" x2="770" y2="146" class="ln" stroke-dasharray="3 3"/>
  <line x1="100" y1="206" x2="770" y2="206" class="ln" stroke-dasharray="3 3"/>
  <line x1="100" y1="266" x2="770" y2="266" class="ln" stroke-dasharray="3 3"/>
  <text x="16" y="300" font-size="12" class="ts">稳态（pp_size=4）：同一时刻 4 个在飞 step 错位分布在 4 个 stage 上，每个 stage 都有活干；颜色 = step。</text>
  <text x="16" y="319" font-size="12" class="ts">同一请求（如 T0 里的 req A）两次 decode 至少隔 pp_size 步才会再被调度（decode_stagger），避免跨 step 的 KV 写冲突。</text>
</svg>

<h2 id="decode-stagger">
  <span class="i18n-zh">decode_stagger：同请求的环形节奏</span>
  <span class="i18n-en">decode_stagger ring cadence</span>
</h2>

<p>
  <span class="i18n-zh">多个 step 在飞后有个新问题：同一个请求能不能连续两步都被调度 decode？不能——它上一步的采样 token 还没回到首级。AsyncScheduler + MRv2 的解法（<code>async_scheduler.py</code>）：<code>decode_stagger = pp_size</code>，每次调度 decode 时设 <code>request.next_decode_eligible_step = current_step + pp_size</code>；<code>Scheduler.schedule()</code> 里直接跳过未到期的请求，源码注释原话：「enforce pp_size steps between same-req decodes <strong>to match worker-side sampled-tokens broadcast slot ring cadence</strong>」——即对齐 worker 侧「采样 token 广播槽位环」的节奏。副作用是天然的：每个在飞 step 携带的 decode 请求集合互不相同，恰好铺满各级流水。（XPU 平台可用 <code>VLLM_XPU_PP_MICROBATCH=0</code> 关掉，stagger 退回 1。）</span>
</p>

<h2 id="token-回传">
  <span class="i18n-zh">采样 token 怎么回首级：两条路径</span>
  <span class="i18n-en">Sampled-token return paths</span>
</h2>

<svg class="dg" viewBox="0 0 860 210" role="img" aria-label="采样 token 两条回传路径">
  <defs>
    <marker id="pparr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0L10,5L0,10z" class="arrp"/>
    </marker>
  </defs>
  <text x="20" y="30" font-size="13">同步调度（默认 Scheduler）：</text>
  <rect x="20" y="42" width="150" height="46" rx="8" class="b"/>
  <text x="95" y="62" text-anchor="middle" font-size="12">末级 stage 采样</text>
  <text x="95" y="80" text-anchor="middle" font-size="11" class="ts">ModelRunnerOutput</text>
  <line x1="170" y1="65" x2="204" y2="65" class="ln" marker-end="url(#pparr)"/>
  <rect x="206" y="42" width="170" height="46" rx="8" class="b"/>
  <text x="291" y="70" text-anchor="middle" font-size="12">Executor 回引擎核心</text>
  <line x1="376" y1="65" x2="410" y2="65" class="ln" marker-end="url(#pparr)"/>
  <rect x="412" y="42" width="190" height="46" rx="8" class="ba"/>
  <text x="507" y="62" text-anchor="middle" font-size="12">调度器 update_from_output</text>
  <text x="507" y="80" text-anchor="middle" font-size="11" class="ts">记下每个请求的新 token</text>
  <line x1="602" y1="65" x2="636" y2="65" class="ln" marker-end="url(#pparr)"/>
  <rect x="638" y="42" width="204" height="46" rx="8" class="b"/>
  <text x="740" y="62" text-anchor="middle" font-size="12">下一步 SchedulerOutput</text>
  <text x="740" y="80" text-anchor="middle" font-size="11" class="ts">把 new_token_ids 带回首级</text>
  <text x="20" y="128" font-size="13">异步调度（AsyncScheduler + MRv2）：</text>
  <rect x="20" y="140" width="150" height="46" rx="8" class="bg"/>
  <text x="95" y="160" text-anchor="middle" font-size="12">末级 stage 采样</text>
  <text x="95" y="178" text-anchor="middle" font-size="11" class="ts">不等调度器</text>
  <line x1="170" y1="163" x2="204" y2="163" class="ln" marker-end="url(#pparr)"/>
  <rect x="206" y="140" width="220" height="46" rx="8" class="bg"/>
  <text x="316" y="160" text-anchor="middle" font-size="12">GPU broadcast 直达首级</text>
  <text x="316" y="178" text-anchor="middle" font-size="11" class="ts">槽位环，_pp_recv_work</text>
  <line x1="426" y1="163" x2="460" y2="163" class="ln" marker-end="url(#pparr)"/>
  <rect x="462" y="140" width="180" height="46" rx="8" class="b"/>
  <text x="552" y="160" text-anchor="middle" font-size="12">首级 _prepare_input_ids</text>
  <text x="552" y="178" text-anchor="middle" font-size="11" class="ts">等待并同步广播结果</text>
  <line x1="642" y1="163" x2="676" y2="163" class="ln" marker-end="url(#pparr)"/>
  <rect x="678" y="140" width="164" height="46" rx="8" class="ba"/>
  <text x="760" y="160" text-anchor="middle" font-size="12">调度器只做对账</text>
  <text x="760" y="178" text-anchor="middle" font-size="11" class="ts">占位符 → 真 token</text>
  <text x="20" y="205" font-size="12" class="ts">异步路径正是 decode_stagger 的原因：调度器在 token 回来前就要签发下一步，靠占位符（num_output_placeholders、spec_token_ids=-1）先记账，事后对账</text>
</svg>

<h2 id="边界与易混淆">
  <span class="i18n-zh">边界与易混淆点</span>
  <span class="i18n-en">Boundaries &amp; gotchas</span>
</h2>

<ul>
  <li><strong>PCP / DCP 不是流水线</strong>：<span class="i18n-zh"><code>prefill_context_parallel_size</code>（PCP）与 <code>decode_context_parallel_size</code>（DCP）是 prefill / decode 的<strong>上下文并行</strong>（沿序列维切），和 PP 正交；本周周报里「vllm bench forward 加 PCP 支持」即是它。</span></li>
  <li><strong>没有 Megatron 式 1F1B 虚拟级</strong>：<span class="i18n-zh">层不会拆成虚拟段交替执行；「交错」全部由多 step 在飞实现。单步内也不再切微批——torchrun 后端的高效 PP（issue #18019，已关闭）是相关历史，runner 里仍留着「Support overlapping micro-batches」的 TODO。</span></li>
  <li><strong>V1 runner 的限制</strong>：<span class="i18n-zh">异步调度 + PP 只在 MRv2（<code>VLLM_USE_V2_MODEL_RUNNER</code>，新平台/新特性已默认）下完整支持；V1 runner 注释明说不完整。stagger 机制也只挂在 <code>use_v2_model_runner</code> 分支下。</span></li>
  <li><strong>prefill 节流</strong>：<span class="i18n-zh">DP+PP 下有 <code>prefill_schedule_interval</code> 节奏控制与 <code>defer_prefills</code>（把 prefill chunk 挪到 cadence 对齐的 step），decode 优先填满流水。</span></li>
  <li><strong>和 KV connector 的交集</strong>：<span class="i18n-zh">PD 分离 + PP 时，connector 握手按 (pp_rank, tp_rank) 建立通道（<code>set_xfer_handshake_metadata_pp_aware</code>，不支持 PP 分片聚合的 connector 会直接报错）。</span></li>
</ul>

<h2 id="源码定位">
  <span class="i18n-zh">源码定位表</span>
  <span class="i18n-en">Source map</span>
</h2>

<table class="srctable">
  <thead><tr><th><span class="i18n-zh">机制</span></th><th><span class="i18n-zh">位置</span></th></tr></thead>
  <tbody>
    <tr><td><span class="i18n-zh">切层（连续均匀 + 配平 / 自定义）</span></td><td><code>vllm/distributed/utils.py: get_pp_indices</code>，<code>VLLM_PP_LAYER_PARTITION</code></td></tr>
    <tr><td><span class="i18n-zh">在飞深度</span></td><td><code>vllm/config/vllm.py: VllmConfig.max_concurrent_batches</code>；<code>EngineCore.step_with_batch_queue</code></td></tr>
    <tr><td><span class="i18n-zh">SchedulerOutput 广播 / 结果回传</span></td><td><code>vllm/v1/executor/multiproc_executor.py: rpc_broadcast_mq</code></td></tr>
    <tr><td><span class="i18n-zh">级间 intermediate 传递、两种 token 回传</span></td><td><code>vllm/v1/worker/gpu_model_runner.py</code>（<code>sync_and_gather_intermediate_tensors</code>、<code>_pp_recv_work</code>）</td></tr>
    <tr><td><span class="i18n-zh">decode_stagger / 占位符</span></td><td><code>vllm/v1/core/sched/async_scheduler.py</code>；<code>scheduler.py</code>（<code>next_decode_eligible_step</code> 检查）</td></tr>
    <tr><td><span class="i18n-zh">PP 感知的 connector 握手</span></td><td><code>vllm/distributed/kv_transfer/kv_connector/v1/base.py</code></td></tr>
  </tbody>
</table>

<p><em><span class="i18n-zh">基于 vLLM master @ 2026-10-28；PP 调度仍在快速演进（MRv2 / async scheduler），以最新源码为准。</span></em></p>
