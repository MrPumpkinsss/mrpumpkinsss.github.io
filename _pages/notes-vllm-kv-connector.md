---
layout: single
title: "KV Connector"
permalink: /notes/vllm-kv-connector/
author_profile: true
---

<style>
  .dg { width: 100%; height: auto; display: block; margin: 8px 0 2px; }
  .dg .b  { fill: #eef3fd; stroke: #7a97d4; stroke-width: 1.2; }
  .dg .ba { fill: #fff3e0; stroke: #e0a04a; stroke-width: 1.4; }
  .dg .bg { fill: #e9f6ee; stroke: #59a97c; stroke-width: 1.2; }
  .dg .br { fill: #fdeaea; stroke: #d98a8a; stroke-width: 1.2; }
  .dg text { fill: #333; font-family: inherit; }
  .dg .ts { fill: #666; }
  .dg .ln { stroke: #7a879d; stroke-width: 1.4; fill: none; }
  .dg .arrp { fill: #7a879d; }
  html[data-theme="dark"] .dg .b  { fill: #2b3550; stroke: #6f8cc9; }
  html[data-theme="dark"] .dg .ba { fill: #41321b; stroke: #d9a04b; }
  html[data-theme="dark"] .dg .bg { fill: #1f3a2a; stroke: #5cb987; }
  html[data-theme="dark"] .dg .br { fill: #452525; stroke: #c97a7a; }
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
    <li><span class="i18n-zh">KV Connector = vLLM 和「外部 KV 存储 / 另一个 vLLM 实例」之间<strong>搬 KV 的统一插口</strong>；PD 分离、KV 卸载、跨实例共享缓存，全是这一个接口在撑。</span></li>
    <li><span class="i18n-zh">一个 connector 类跑<strong>两份实例</strong>：调度器里那份「签单」（决定搬什么），worker 里那份「搬货」（真动数据）；每步传一张计划单（Metadata），干完交回执（Output）。</span></li>
    <li><span class="i18n-zh">想自己写一个：从 <code>ExampleConnector</code> 抄骨架，实现约 10 个 hook，用 <code>kv_connector_module_path</code> 外挂就能跑，不必改 vLLM 源码。</span></li>
  </ul>
</div>

<h2 id="先统一几个词">
  <span class="i18n-zh">先统一几个词</span>
  <span class="i18n-en">Terms first</span>
</h2>

<table class="srctable">
  <tbody>
    <tr><td><strong>KV cache（<span class="i18n-zh">键值缓存</span>）</strong></td><td><span class="i18n-zh">模型为已生成的每个 token 缓存的注意力中间结果，生成每个新 token 都要读它；没有它，每出一个字都得把全部历史重算一遍</span></td></tr>
    <tr><td><strong>PD <span class="i18n-zh">分离</span></strong></td><td>Prefill / Decode <span class="i18n-zh">分离：「读入整个 prompt 并算 KV」（prefill）和「逐 token 生成」（decode）拆到不同机器实例上，KV 从 prefill 侧传给 decode 侧</span></td></tr>
    <tr><td><strong><span class="i18n-zh">卸载</span>（offload）</strong></td><td><span class="i18n-zh">把暂时不用的 KV 从显存挪到 CPU 内存 / 硬盘 / 远端，要用再取回</span></td></tr>
    <tr><td><strong>hook（<span class="i18n-zh">钩子</span>）</strong></td><td><span class="i18n-zh">vLLM 在固定执行点位回调的函数；「写一个 connector」＝实现下文列出的这些 hook</span></td></tr>
    <tr><td><strong>TP / rank</strong></td><td>TP＝<span class="i18n-zh">张量并行（把一层的计算切到多张卡同时算）；rank＝进程在并行组里的编号</span></td></tr>
    <tr><td><strong>paged KV buffer</strong></td><td><span class="i18n-zh">经 PagedAttention 分页管理的显存 KV 区域（一块块「页」拼成的逻辑连续缓存）</span></td></tr>
    <tr><td><strong>slot（<span class="i18n-zh">槽位</span>）</strong></td><td><span class="i18n-zh">KV cache 里一个 token 占的位置</span></td></tr>
    <tr><td><strong>CUDA graph</strong></td><td><span class="i18n-zh">把一串 GPU 操作录制下来整图重放的技术，省掉每步的 CPU 启动开销</span></td></tr>
  </tbody>
</table>

<h2 id="一句话定位">
  <span class="i18n-zh">它是干什么的</span>
  <span class="i18n-en">What it is</span>
</h2>

<p>
  <span class="i18n-zh"><strong>白话版</strong>：把 vLLM 想成一个只管算的工厂，KV cache 是它的半成品仓库。Connector 就是工厂和外部仓库之间的<strong>物流接口</strong>，典型用法有三种——</span>
</p>

<table class="srctable">
  <tbody>
    <tr><td><strong>PD 分离</strong></td><td><span class="i18n-zh">prefill 工厂算完，把半成品（KV）运给 decode 工厂继续生成</span></td></tr>
    <tr><td><strong>KV 卸载</strong></td><td><span class="i18n-zh">GPU 仓放不下的 KV，挪到 CPU / 硬盘 / 远端仓库，要用再取回来</span></td></tr>
    <tr><td><strong>缓存共享</strong></td><td><span class="i18n-zh">多家工厂共用一个仓库：别的实例算过的前缀，直接取，不重算</span></td></tr>
  </tbody>
</table>

<p>
  <span class="i18n-zh"><strong>源码版</strong>：代码在 <code>vllm/distributed/kv_transfer/</code>，核心是抽象类 <code>KVConnectorBase_V1</code>（<code>v1/base.py</code>，接口标注 experimental）。vLLM 不关心 KV 存在哪、用什么网络传，只在调度和模型执行的固定点位回调你实现的 hook。</span>
</p>

<h2 id="双角色设计">
  <span class="i18n-zh">双角色设计：一个类，两份实例</span>
  <span class="i18n-en">One class, two roles</span>
</h2>

<p>
  <span class="i18n-zh"><strong>为什么要两份？</strong>因为调度器和 worker 是不同进程，看到的时机也不同。factory（<code>factory.py</code>）会把同一个 connector 类实例化两次，注释原话是「构建时强制分离」：<code>KVConnectorRole.SCHEDULER</code> 副本只做<strong>决策与记账</strong>，<code>KVConnectorRole.WORKER</code> 副本只做<strong>数据搬运</strong>。两侧不直接通信，全靠三个对象每步流转：</span>
</p>

<ul>
  <li><code>KVConnectorMetadata</code>：<span class="i18n-zh">计划单，调度器 → worker，随 <code>SchedulerOutput</code> 下发</span></li>
  <li><code>KVConnectorOutput</code>：<span class="i18n-zh">回执，worker → 调度器，报完成 / 失败</span></li>
  <li><code>KVConnectorHandshakeMetadata</code>：<span class="i18n-zh">P/D 实例之间的带外握手（支持按 (pp_rank, tp_rank) 建 PP 感知通道）</span></li>
</ul>

<h3 id="调度器侧-hooks">调度器侧：签单的五个 hook</h3>

<table class="srctable">
  <thead><tr><th>hook</th><th><span class="i18n-zh">何时被调</span></th><th><span class="i18n-zh">干什么</span></th></tr></thead>
  <tbody>
    <tr><td><code>get_num_new_matched_tokens</code></td><td><span class="i18n-zh">请求调度时</span></td><td><span class="i18n-zh">「外部缓存里还有多少 token 可以白嫖？」返回 <code>None</code> = 我还在查，稍后再问</span></td></tr>
    <tr><td><code>update_state_after_alloc</code></td><td><span class="i18n-zh">块分配后</span></td><td><span class="i18n-zh">给命中的 token 登记落地块；异步加载时同一请求会被调两次（先给加载目标块，加载完再补一次）</span></td></tr>
    <tr><td><code>build_connector_meta</code></td><td><span class="i18n-zh">每步</span></td><td><span class="i18n-zh">把本步搬运计划打包成 Metadata，随 <code>SchedulerOutput</code> 下发</span></td></tr>
    <tr><td><code>update_connector_output</code></td><td><span class="i18n-zh">收到回执后</span></td><td><span class="i18n-zh">汇总 worker 报来的完成 / 失败，唤醒挂起的请求</span></td></tr>
    <tr><td><code>request_finished</code></td><td><span class="i18n-zh">请求结束时</span></td><td><span class="i18n-zh">可返回 True 接管块（异步保存完再放人）；可附 <code>KVTransferParams</code> 写进输出，提示下游实例</span></td></tr>
  </tbody>
</table>

<h3 id="worker侧-hooks">Worker 侧：搬货的七个 hook</h3>

<table class="srctable">
  <thead><tr><th>hook</th><th><span class="i18n-zh">何时被调</span></th><th><span class="i18n-zh">干什么</span></th></tr></thead>
  <tbody>
    <tr><td><code>register_kv_caches</code></td><td><span class="i18n-zh">启动时</span></td><td><span class="i18n-zh">把 paged KV buffer 登记给 connector（NIXL＝NVIDIA 的 KV 传输库，免拷贝传输的基础）</span></td></tr>
    <tr><td><code>bind_connector_metadata</code></td><td><span class="i18n-zh">每步 forward 前</span></td><td><span class="i18n-zh">收到调度器的计划单，步后清除</span></td></tr>
    <tr><td><code>start_load_kv</code></td><td><span class="i18n-zh">forward 前</span></td><td><span class="i18n-zh">启动异步加载（提交后不阻塞）</span></td></tr>
    <tr><td><code>wait_for_layer_load</code></td><td><span class="i18n-zh">每层 attention 执行前</span></td><td><span class="i18n-zh">只等「这一层」的 KV 到位 —— 第 N 层在算时，第 N+1 层的 KV 还在路上，层与层流水重叠</span></td></tr>
    <tr><td><code>save_kv_layer</code></td><td><span class="i18n-zh">每层算完</span></td><td><span class="i18n-zh">立即启动该层异步保存（生产侧不等整个 forward 结束）</span></td></tr>
    <tr><td><code>wait_for_save</code></td><td><span class="i18n-zh">每步末尾</span></td><td><span class="i18n-zh">提交并同步所有保存（含空步、在 draft 之后）</span></td></tr>
    <tr><td><code>get_finished</code> / <code>get_block_ids_with_load_errors</code></td><td><span class="i18n-zh">每步</span></td><td><span class="i18n-zh">上报哪些请求搬完了 / 哪些块搬失败了</span></td></tr>
  </tbody>
</table>

<p>
  <span class="i18n-zh">一句话总结：<strong>调度器决定「搬什么、什么时候搬」，worker 决定「怎么搬」，两侧之间只传轻量元数据。</strong></span>
</p>

<div class="diagram-fig">
  <img src="/files/diagrams/export/kvconn-01-d.svg" alt="KV Connector 双角色 hook 时序图">
</div>

<h2 id="消费侧生命周期">
  <span class="i18n-zh">消费侧：一个请求怎么「等 KV」</span>
  <span class="i18n-en">Consumer-side lifecycle</span>
</h2>

<p>
  <span class="i18n-zh">走一遍最典型的场景——新请求进来，外部缓存里有它的前缀（对应 <code>scheduler.py</code> 的实现）：</span>
</p>

<ol>
  <li><span class="i18n-zh"><strong>问一嘴</strong>：调度器调 <code>get_num_new_matched_tokens</code>，connector 答命中共 8000 token，且<strong>异步加载</strong>。</span></li>
  <li><span class="i18n-zh"><strong>占座</strong>：CacheManager 给这 8000 token 分好落地块，<code>update_state_after_alloc</code> 登记。</span></li>
  <li><span class="i18n-zh"><strong>挂起</strong>：请求进入 <code>WAITING_FOR_REMOTE_KVS</code> 状态——不占 GPU 步，其他请求照常跑。</span></li>
  <li><span class="i18n-zh"><strong>后台搬</strong>：worker <code>start_load_kv</code> 逐层拉 KV，到位一层就能算一层。</span></li>
  <li><span class="i18n-zh"><strong>叫醒</strong>：全部到位后 <code>KVConnectorOutput</code> 上报，请求放回队列，从第 8000 个 token 继续算。</span></li>
  <li><span class="i18n-zh"><strong>失败兜底</strong>：坏块经 <code>get_block_ids_with_load_errors</code> 上报，按 <code>kv_load_failure_policy</code> 处理——<code>recompute</code>（这几块重新算，稳妥）或 <code>fail</code>（请求直接报错结束）。</span></li>
</ol>

<div class="diagram-fig">
  <img src="/files/diagrams/export/kvconn-02-d.svg" alt="消费侧 KV 加载状态流">
</div>

<h2 id="隐性约束">
  <span class="i18n-zh">五个容易踩的坑</span>
  <span class="i18n-en">Gotchas</span>
</h2>

<ul>
  <li><strong><span class="i18n-zh">CUDA Graph 会吞掉你的同步点</span></strong>：<span class="i18n-zh">逐层 load/save 不能被 graph 捕获（replay 时会被跳过，产生数据竞争）。所以这类 connector 必须让 <code>requires_piecewise_for_cudagraph()</code> 返回 True，用 PIECEWISE 模式在 graph 片段之间插入同步。</span></li>
  <li><strong><span class="i18n-zh">异步保存期间，块可能被复用</span></strong>：<span class="i18n-zh"><code>request_finished</code> 返回 True = 「块先别放，我在异步保存」；直到 <code>get_finished</code> 报完成才真正释放。<code>requires_kv_delivery</code> 再补一刀：抢占时宁可重算，也不能交出没送完的 KV。</span></li>
  <li><strong><span class="i18n-zh">HMA（混合内存分配器）</span></strong>：<span class="i18n-zh">多 KV cache group 开启时，connector 必须实现 <code>SupportsHMA</code>，否则 factory 直接报错让你加 <code>--disable-hybrid-kv-cache-manager</code>。MultiConnector 特殊：所有子 connector 都支持才算支持。</span></li>
  <li><strong><span class="i18n-zh">投机解码会推迟收尾</span></strong>：<span class="i18n-zh"><code>wait_for_save</code> 被推迟到 draft 之后（<code>defer_kv_connector_finalize</code>）——这就是 hook 注释里「每步一次，含空步、在 draft 之后」的由来。</span></li>
  <li><strong><span class="i18n-zh">sleep mode</span></strong>：<span class="i18n-zh">显存被睡眠机制搬走重映射时，connector 要配合 <code>unregister_kv_caches / restore_kv_caches</code>。</span></li>
</ul>

<h2 id="配置与内置实现">
  <span class="i18n-zh">怎么配、有哪些现成的</span>
  <span class="i18n-en">Config &amp; built-ins</span>
</h2>

<p>
  <span class="i18n-zh">两行命令就能体验（PD 两侧各起一个实例）：</span>
</p>

```bash
# 生产侧（算完把 KV 交出去）
vllm serve MODEL --port 8100 \
  --kv-transfer-config '{"kv_connector":"NixlConnector","kv_role":"kv_producer"}'
# 消费侧（直接拿别人的 KV 续算）
vllm serve MODEL --port 8200 \
  --kv-transfer-config '{"kv_connector":"NixlConnector","kv_role":"kv_consumer"}'
```

<table class="srctable">
  <thead><tr><th><span class="i18n-zh">字段（KVTransferConfig）</span></th><th><span class="i18n-zh">含义</span></th></tr></thead>
  <tbody>
    <tr><td><code>kv_connector</code></td><td><span class="i18n-zh">内置注册名，或自定义类名（配合下一行）</span></td></tr>
    <tr><td><code>kv_role</code></td><td><code>kv_producer / kv_consumer / kv_both</code></td></tr>
    <tr><td><code>kv_connector_module_path</code></td><td><span class="i18n-zh">外部 connector 的 Python 模块路径（<strong>不改源码接入自己的实现</strong>，构造签名不对会直接报错）</span></td></tr>
    <tr><td><code>kv_connector_extra_config</code></td><td><span class="i18n-zh">各 connector 自己的参数袋</span></td></tr>
    <tr><td><code>kv_load_failure_policy</code></td><td><code>recompute</code> / <code>fail</code></td></tr>
  </tbody>
</table>

<p>
  <span class="i18n-zh">内置注册了 16 个（<code>factory.py</code>），按场景挑：</span>
</p>

<table class="srctable">
  <thead><tr><th><span class="i18n-zh">场景</span></th><th><span class="i18n-zh">选谁</span></th></tr></thead>
  <tbody>
    <tr><td><span class="i18n-zh">PD 分离（跨机传 KV）</span></td><td><code>NixlConnector</code>（pull/push 变体都有）、<code>MooncakeConnector</code></td></tr>
    <tr><td><span class="i18n-zh">集中式 KV 存储</span></td><td><code>MooncakeStoreConnector</code>、<code>LMCacheConnectorV1</code>、<code>HF3FSKVConnector</code>（3FS）</td></tr>
    <tr><td><span class="i18n-zh">GPU → CPU 卸载</span></td><td><code>OffloadingConnector</code>、<code>SimpleCPUOffloadConnector</code></td></tr>
    <tr><td><span class="i18n-zh">多级缓存（内存→盘→远端依次问）</span></td><td><code>MultiConnector</code> <span class="i18n-zh">级联子 connector</span></td></tr>
    <tr><td><span class="i18n-zh">生态 / 实验</span></td><td><code>FlexKVConnectorV1</code>、<code>HiSparseConnector</code>、<code>MoRIIOConnector</code>、<code>DecodeBenchConnector</code></td></tr>
    <tr><td><span class="i18n-zh">自己写的起点</span></td><td><code>ExampleConnector</code>（标准骨架）、<code>ExampleHiddenStatesConnector</code>（传隐状态）</td></tr>
  </tbody>
</table>

<h2 id="与周报勾连">
  <span class="i18n-zh">延伸阅读</span>
  <span class="i18n-en">Going deeper</span>
</h2>

<ul>
  <li><span class="i18n-zh">本周周报的「KV Offload P2P 提速失败判定」（#63781）就是这个体系里 NIXL P2P 层的超时调优；机制本体在 <code>vllm/v1/kv_offload/</code>，靠 connector 接口挂进调度。</span></li>
  <li><span class="i18n-zh">读源码顺序：<code>base.py</code>（接口）→ <code>example_connector.py</code>（最小实现）→ <code>offloading_connector.py</code>（异步保存 + 抢占保护的完整范例）→ <code>nixl/</code>（真实 PD 分离，pull/push 双模式，scheduler 和 worker 分文件）。</span></li>
  <li><span class="i18n-zh">PP 分离下还要注意 PP 感知握手，见姊妹篇「<a href="/notes/vllm-pp/">PP 流水线交错执行</a>」。</span></li>
</ul>

<p><em><span class="i18n-zh">基于 vLLM master @ 2026-10-28（接口标注 experimental，随时会变）；所有文件路径均在上游仓库核实。</span></em></p>
