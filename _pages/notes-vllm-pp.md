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
  <strong><span class="i18n-zh">先记住三件事</span><span class="i18n-en">TL;DR</span></strong>
  <ul>
    <li><span class="i18n-zh">PP 把模型按层<strong>连续切段</strong>，每段（叫一个 stage）由一组进程执行（进程编号叫 rank）；一个请求的层永远不会拆到两段。</span></li>
    <li><span class="i18n-zh">流水线不空转的关键不是切微批，而是<strong>让 pp_size 个调度步（step，见下表）同时在飞</strong>（「在飞」＝已签发还没跑完；异步调度 + MRv2 再多 1 个）——每个 stage 手里永远有不同的 step。</span></li>
    <li><span class="i18n-zh">同一请求两次 decode <strong>强制间隔 ≥ pp_size 步</strong>（<code>decode_stagger</code>），对齐采样 token 的回传节奏——这是多个 step 能安全并存的根本。</span></li>
  </ul>
</div>

<h2 id="先统一几个词">
  <span class="i18n-zh">先统一几个词</span>
  <span class="i18n-en">Terms first</span>
</h2>

<table class="srctable">
  <tbody>
    <tr><td><strong>PP</strong></td><td>pipeline parallelism，<span class="i18n-zh">流水线并行：把模型按层切成 pp_size 段，各段放在不同进程/卡上，像流水线一样逐段接力</span></td></tr>
    <tr><td><strong>stage / rank</strong></td><td><span class="i18n-zh">一「段」叫一个 stage；执行它的那组进程按段编号叫 rank（stage 0 的进程就是 rank 0）</span></td></tr>
    <tr><td><strong>step（调度步）</strong></td><td><span class="i18n-zh">调度器排一次批 + 各 stage 各做一次前向，算一个 step；下文图里的 T0～T5 就是 step 的编号</span></td></tr>
    <tr><td><strong><span class="i18n-zh">在飞</span></strong></td><td><span class="i18n-zh">in-flight：已签发、还没跑出结果的 step</span></td></tr>
    <tr><td><strong>DP</strong></td><td>data parallelism，<span class="i18n-zh">数据并行：复制多份完整引擎，各管各的请求</span></td></tr>
    <tr><td><strong>MRv2</strong></td><td>Model Runner V2，<span class="i18n-zh">vLLM 新一代「模型执行器」——负责把调度决定真正跑在 GPU 上的那层代码</span></td></tr>
    <tr><td><strong><span class="i18n-zh">异步调度</span></strong></td><td><span class="i18n-zh">AsyncScheduler：调度器不等上一步结果就签发下一步</span></td></tr>
  </tbody>
</table>

<h2 id="一句话定位">
  <span class="i18n-zh">它是怎么「交错」的</span>
  <span class="i18n-en">How it interleaves</span>
</h2>

<p>
  <span class="i18n-zh"><strong>白话版</strong>：一条 4 工位的流水线，如果整条线同一时刻只装一辆车，那么工位 2、3、4 大部分时间在发呆。vLLM 的做法<strong>不是把一辆车拆成四份</strong>（没有虚拟级），而是<strong>让 4 辆车同时在线上</strong>——每个工位手里永远有不同的车。所以「交错」发生在 <strong>step 之间</strong>（不同请求的批错位前进），而不是 step 之内。</span>
</p>

<p>
  <span class="i18n-zh"><strong>源码版</strong>：这个深度不是拍脑袋——<code>VllmConfig.max_concurrent_batches</code> 的注释原话就是「<strong>PP requires PP-size concurrent batches to fill the pipeline. Async scheduling requires 2 concurrent batches to overlap.</strong>」取值：<code>PP&gt;1</code> → <code>pp_size</code>；异步调度 + MRv2 → <code>pp_size+1</code>（多出的 1 个在调度侧预备下一步）。</span>
</p>

<h2 id="静态切分">
  <span class="i18n-zh">先说切层：连续、均匀、配平</span>
  <span class="i18n-en">Layer partitioning</span>
</h2>

<table class="srctable">
  <tbody>
    <tr><td><strong><span class="i18n-zh">切法</span></strong></td><td><code>get_pp_indices</code> <span class="i18n-zh">把层<strong>连续均匀</strong>分给各 rank（48 层 pp=4 → 每段 12 层）</span></td></tr>
    <tr><td><strong><span class="i18n-zh">配平</span></strong></td><td><span class="i18n-zh">除不尽的余量优先摊给中间段——首段带 embedding、末段带 lm_head + norm，刻意少给一层换显存平衡</span></td></tr>
    <tr><td><strong><span class="i18n-zh">自定义</span></strong></td><td><code>VLLM_PP_LAYER_PARTITION="20,20,20,20"</code> <span class="i18n-zh">手动指定每段层数（长度须等于 pp_size）</span></td></tr>
    <tr><td><strong><span class="i18n-zh">没有的</span></strong></td><td><span class="i18n-zh">Megatron 式虚拟级：一个请求的层不会被拆到两个 stage 交替执行</span></td></tr>
  </tbody>
</table>

<h2 id="一步的执行">
  <span class="i18n-zh">一个 step 的完整旅程</span>
  <span class="i18n-en">One step, end to end</span>
</h2>

<ol>
  <li><span class="i18n-zh">调度器（跑在「引擎核心」进程里——vLLM 中驱动「调度 → 执行」循环的进程）产出一份 <code>SchedulerOutput</code>（本步的计划：调度了哪些请求、各算几个 token、KV 块怎么分）。</span></li>
  <li><span class="i18n-zh">Executor（管理全部 worker 进程的执行器）用共享内存消息队列（内部叫 <code>rpc_broadcast_mq</code>）把它<strong>广播给所有流水线级的 worker 进程</strong>。</span></li>
  <li><span class="i18n-zh">Stage 0 算自己那段层，把算出的中间结果（代码里叫 <code>intermediate_tensors</code>）点对点直接递给 stage 1，逐级传递。</span></li>
  <li><span class="i18n-zh">最后一级采样，结果回到引擎核心（两条路径，见下节）。</span></li>
  <li><span class="i18n-zh">调度器记账、签发下一步——同时上一步可能还在 GPU 上跑（靠「batch queue」：一个攒着已签发、未完成 step 的队列，深度见下节）。</span></li>
</ol>

<div class="diagram-fig">
  <img src="/files/diagrams/export/pp-01-d.svg" alt="PP 流水线在飞 step 时空图">
</div>

<h3 id="faq-batch">
  <span class="i18n-zh">常见疑问：pp=N 就是「N 个固定 batch」？请求怎么分进 batch？</span>
  <span class="i18n-en">FAQ: is pp=N a fixed number of batches?</span>
</h3>

<p>
  <span class="i18n-zh">不是固定分组。整个引擎只有<strong>一个调度器</strong>和<strong>一条 running 队列</strong>（默认先来先服务，FCFS）；每个 step 的 batch 就是「这一步从队列头部往后扫、能塞进 token 预算的那批请求」。pp=N 的含义是<strong>这样的 step 同时有 N 个在流水线里错位执行</strong>——是时间上的重叠，不是把请求分成 N 组。请求也<strong>不归属任何 stage</strong>：每个 step 的 batch 会依次流过全部 stage，各 stage 算的是同一批请求的不同层段。</span>
</p>

<p>
  <span class="i18n-zh">请求进 batch 的具体规则（<code>scheduler.py</code> 的 running 循环）：按 running 队列顺序扫描，跳过未到期（decode_stagger）、被 defer 或块分配失败的请求，剩余 token 预算装得下多少就装多少；新请求从 waiting 队列按 FCFS 追加到 running 尾部。同步调度下 decode 请求<strong>每个 step 都在 batch 里</strong>（上一步采样的 token 由调度器转交进下一步）；异步 + MRv2 下同请求强制隔 pp_size 步（decode_stagger），于是 N 个在飞 batch 的 decode 请求集合天然互不相同。</span>
</p>

<h2 id="decode-stagger">
  <span class="i18n-zh">decode_stagger：多个 step 并存的保险丝</span>
  <span class="i18n-en">decode_stagger</span>
</h2>

<p>
  <span class="i18n-zh"><strong>问题</strong>：步和步重叠之后，如果同一个请求连续两步都被调度 decode，第二步要用的输入（上一步采样出的 token）还没从流水线末端走回来——数据竞态。</span>
</p>

<p>
  <span class="i18n-zh"><strong>解法</strong>（<code>async_scheduler.py</code>）：记一个步号 <code>next_decode_eligible_step = 当前步 + pp_size</code>；调度时没到期的请求直接跳过。<code>Scheduler.schedule()</code> 里的注释原话：enforce pp_size steps between same-req decodes <strong>to match worker-side sampled-tokens broadcast slot ring cadence</strong>——对齐 worker 侧「采样 token 广播槽位环」的节奏。</span>
</p>

<p>
  <span class="i18n-zh"><strong>副作用恰好是优点</strong>：每个在飞 step 携带的 decode 请求集合天然互不相同，正好铺满各级流水。XPU 平台可用 <code>VLLM_XPU_PP_MICROBATCH=0</code> 关闭（stagger 退回 1）。</span>
</p>

<h2 id="token-回传">
  <span class="i18n-zh">采样 token 怎么回首级：两条路</span>
  <span class="i18n-en">Sampled-token return paths</span>
</h2>

<table class="srctable">
  <thead><tr><th></th><th><span class="i18n-zh">路径</span></th><th><span class="i18n-zh">代价</span></th></tr></thead>
  <tbody>
    <tr>
      <td><strong><span class="i18n-zh">同步调度</span></strong><br><span class="i18n-zh">（默认 Scheduler）</span></td>
      <td><span class="i18n-zh">末级采样 → Executor → 调度器 <code>update_from_output</code> → <strong>下一步的 SchedulerOutput 把 new_token_ids 带回首级</strong>（首级 worker 自己没有和末级的通信）</span></td>
      <td><span class="i18n-zh">token 绕一圈软件栈；调度器必须等每步结果</span></td>
    </tr>
    <tr>
      <td><strong><span class="i18n-zh">异步调度</span></strong><br><span class="i18n-zh">（AsyncScheduler + MRv2）</span></td>
      <td><span class="i18n-zh">末级采样后 <strong>GPU broadcast 直达首级</strong>（<code>_pp_recv_work</code>，在 <code>_prepare_input_ids</code> 里同步等待）</span></td>
      <td><span class="i18n-zh">调度器不等结果，先签发下一步；用占位符记账（<code>num_output_placeholders</code>、spec token 填 -1），事后对账</span></td>
    </tr>
  </tbody>
</table>

<div class="diagram-fig">
  <img src="/files/diagrams/export/pp-02-d.svg" alt="采样 token 两条回传路径">
</div>

<h2 id="边界与易混淆">
  <span class="i18n-zh">边界与易混淆点</span>
  <span class="i18n-en">Boundaries &amp; gotchas</span>
</h2>

<ul>
  <li><strong>PCP / DCP 不是流水线</strong>：<span class="i18n-zh"><code>prefill_context_parallel_size</code>（PCP，预填充上下文并行）/ <code>decode_context_parallel_size</code>（DCP，解码上下文并行）是沿<strong>序列维</strong>切的上下文并行，和 PP（沿层切）正交。周报里「bench forward 加 PCP 支持」说的就是它。</span></li>
  <li><strong><span class="i18n-zh">没有 1F1B 虚拟级</span></strong>：<span class="i18n-zh">层不拆虚拟段；「交错」全部由多 step 在飞实现。单步内也不再切微批（runner 里还留着「Support overlapping micro-batches」的 TODO，对应已关闭的 issue #18019）。</span></li>
  <li><strong><span class="i18n-zh">V1 runner 的限制</span></strong>：<span class="i18n-zh">异步调度 + PP 只在 MRv2（<code>VLLM_USE_V2_MODEL_RUNNER</code>，新平台已默认启用）下完整支持；stagger 也只挂在 <code>use_v2_model_runner</code> 分支。</span></li>
  <li><strong><span class="i18n-zh">prefill 节流</span></strong>：<span class="i18n-zh">DP+PP 下有 <code>prefill_schedule_interval</code> 节奏控制，<code>defer_prefills</code> 把 prefill chunk 挪到 cadence 对齐的 step，decode 优先填满流水。</span></li>
  <li><strong><span class="i18n-zh">和 KV connector 的交集</span></strong>：<span class="i18n-zh">PD 分离 + PP 时，connector 握手按 (pp_rank, tp_rank) 建通道（<code>set_xfer_handshake_metadata_pp_aware</code>，不支持 PP 分片的 connector 会直接报错）——见「<a href="/notes/vllm-kv-connector/">KV Connector 机制剖析</a>」。</span></li>
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
  </tbody>
</table>

<p><em><span class="i18n-zh">基于 vLLM master @ 2026-10-28；PP 调度仍在快速演进（MRv2 / async scheduler），以最新源码为准。</span></em></p>
