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
  .dg .bb { fill: #f2f2f4; stroke: #b9bcc4; stroke-width: 1; }
  .dg .br { fill: #fdeaea; stroke: #d98a8a; stroke-width: 1.2; }
  .dg text { fill: #333; font-family: inherit; }
  .dg .ts { fill: #666; }
  .dg .ln { stroke: #7a879d; stroke-width: 1.4; fill: none; }
  .dg .arrp { fill: #7a879d; }
  html[data-theme="dark"] .dg .b  { fill: #2b3550; stroke: #6f8cc9; }
  html[data-theme="dark"] .dg .ba { fill: #41321b; stroke: #d9a04b; }
  html[data-theme="dark"] .dg .bg { fill: #1f3a2a; stroke: #5cb987; }
  html[data-theme="dark"] .dg .bb { fill: #2c2f36; stroke: #565b66; }
  html[data-theme="dark"] .dg .br { fill: #452525; stroke: #c97a7a; }
  html[data-theme="dark"] .dg text { fill: #ddd; }
  html[data-theme="dark"] .dg .ts { fill: #999; }
  html[data-theme="dark"] .dg .ln { stroke: #8a97ad; }
  html[data-theme="dark"] .dg .arrp { fill: #8a97ad; }
  .srctable { width:100%; border-collapse:collapse; margin:10px 0; }
  .srctable th, .srctable td { border:1px solid #ddd; padding:7px 10px; font-size:0.88rem; text-align:left; }
  .srctable th { background:#f5f5f5; }
  html[data-theme="dark"] .srctable th { background:#303338; }
  html[data-theme="dark"] .srctable td { border-color:#444; }
  code { word-break: break-all; }
</style>

<p>
  <a href="/notes/"><span class="i18n-zh">← 返回学习目录</span><span class="i18n-en">← Back to Study Catalog</span></a>
</p>

<div class="i18n-en">
  <p><em>English quick summary: source-level analysis of vLLM's KV Connector framework (V1) — the abstraction behind P/D disaggregation, KV offloading, and cross-instance cache sharing. One connector class, two roles (Scheduler-side decision hooks + Worker-side load/save hooks), metadata passed per engine step. Covers the interface, the async-load request lifecycle (WAITING_FOR_REMOTE_KVS), failure policies, CUDA-graph constraints, and the 16 built-in implementations. (Written in Chinese; based on vLLM master @ 2026-10-28.)</em></p>
</div>

<h2 id="一句话定位">
  <span class="i18n-zh">一句话定位</span>
  <span class="i18n-en">What it is</span>
</h2>

<p>
  <span class="i18n-zh">KV Connector 是 vLLM V1 里把「KV cache 搬进搬出引擎」抽象成统一接口的框架，位于 <code>vllm/distributed/kv_transfer/</code>。它是三件事的公共底座：<strong>PD 分离</strong>（prefill 实例把 KV 交给 decode 实例）、<strong>KV 卸载</strong>（GPU → CPU / 文件系统 / 远端存储，如 LMCache、Mooncake store）、<strong>跨实例缓存共享</strong>（P2P 互取）。核心思想：vLLM 不关心 KV 存在哪、怎么传，只按约定的 hook 在调度器和模型执行的固定点位回调你的实现。</span>
</p>

<h2 id="双角色设计">
  <span class="i18n-zh">双角色设计：一个类，两份实例</span>
  <span class="i18n-en">One class, two roles</span>
</h2>

<p>
  <span class="i18n-zh">每个 connector 被 <code>KVConnectorFactory</code> 实例化<strong>两次</strong>（<code>factory.py</code> 注释原话：构建时强制分离）：<code>KVConnectorRole.SCHEDULER</code> 副本住在调度器进程里做<strong>决策与记账</strong>，<code>KVConnectorRole.WORKER</code> 副本住在每个 TP worker 里做<strong>真正的数据搬运</strong>。两侧靠三种元数据对象解耦，每步一次单向流转：<code>KVConnectorMetadata</code>（调度器 → worker，随 <code>SchedulerOutput</code> 下发）、<code>KVConnectorOutput</code>（worker → 调度器，回传完成/失败）、<code>KVConnectorHandshakeMetadata</code>（P/D 实例间带外握手，支持 PP 感知的 <code>set_xfer_handshake_metadata_pp_aware</code>）。</span>
</p>

<svg class="dg" viewBox="0 0 860 330" role="img" aria-label="KV Connector 双角色 hook 时序图">
  <defs>
    <marker id="karr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0L10,5L0,10z" class="arrp"/>
    </marker>
  </defs>
  <text x="200" y="24" text-anchor="middle" font-size="13">调度器进程（决策 / 记账）</text>
  <text x="620" y="24" text-anchor="middle" font-size="13">Worker 进程（每 TP rank，搬数据）</text>
  <line x1="200" y1="32" x2="200" y2="316" class="ln" stroke-dasharray="4 4"/>
  <line x1="620" y1="32" x2="620" y2="316" class="ln" stroke-dasharray="4 4"/>
  <rect x="30" y="44" width="340" height="46" rx="8" class="b"/>
  <text x="200" y="63" text-anchor="middle" font-size="12">① get_num_new_matched_tokens：外部命中多少 token？</text>
  <text x="200" y="81" text-anchor="middle" font-size="11" class="ts">返回 None 表示需要异步查询，调度器稍后再问</text>
  <rect x="30" y="100" width="340" height="40" rx="8" class="b"/>
  <text x="200" y="119" text-anchor="middle" font-size="12">② update_state_after_alloc：CacheManager 分配块后登记</text>
  <text x="200" y="135" text-anchor="middle" font-size="11" class="ts">异步加载时同一请求可能被调两次（先给加载目标块）</text>
  <rect x="30" y="150" width="340" height="40" rx="8" class="ba"/>
  <text x="200" y="169" text-anchor="middle" font-size="12">③ build_connector_meta：每步把搬运计划打包成 Metadata</text>
  <text x="200" y="185" text-anchor="middle" font-size="11" class="ts">随 SchedulerOutput 下发</text>
  <line x1="370" y1="170" x2="452" y2="196" class="ln" marker-end="url(#karr)"/>
  <rect x="454" y="44" width="388" height="40" rx="8" class="b"/>
  <text x="648" y="63" text-anchor="middle" font-size="12">④ bind_connector_metadata：步前绑定，步后清除</text>
  <text x="648" y="79" text-anchor="middle" font-size="11" class="ts">register_kv_caches：把 paged KV buffer 预注册（NIXL 用）</text>
  <rect x="454" y="94" width="388" height="58" rx="8" class="ba"/>
  <text x="648" y="113" text-anchor="middle" font-size="12">⑤ start_load_kv：forward 前启动异步加载</text>
  <text x="648" y="131" text-anchor="middle" font-size="12">wait_for_layer_load：attention 层执行前逐层等待</text>
  <text x="648" y="147" text-anchor="middle" font-size="11" class="ts">layer-by-layer 流水：加载与上层计算重叠</text>
  <rect x="454" y="162" width="388" height="58" rx="8" class="b"/>
  <text x="648" y="181" text-anchor="middle" font-size="12">⑥ save_kv_layer：每层算完即启动异步保存（生产侧）</text>
  <text x="648" y="199" text-anchor="middle" font-size="12">wait_for_save：步末（含空步、draft 之后）统一收尾</text>
  <text x="648" y="215" text-anchor="middle" font-size="11" class="ts">异步保存必须扣住源块直到 get_finished 报完成</text>
  <line x1="452" y1="240" x2="370" y2="258" class="ln" marker-end="url(#karr)"/>
  <rect x="30" y="200" width="340" height="46" rx="8" class="b"/>
  <text x="200" y="219" text-anchor="middle" font-size="12">⑦ update_connector_output：汇总 worker 回传的完成/失败</text>
  <text x="200" y="237" text-anchor="middle" font-size="11" class="ts">get_finished / get_transfer_results / 块加载错误</text>
  <rect x="30" y="256" width="340" height="46" rx="8" class="bg"/>
  <text x="200" y="275" text-anchor="middle" font-size="12">⑧ request_finished：可返回 True 接管块（异步保存后再放）</text>
  <text x="200" y="293" text-anchor="middle" font-size="11" class="ts">可附带 KVTransferParams 写进请求输出，提示下游实例</text>
  <text x="30" y="322" font-size="12" class="ts">worker 侧另有 take_events（KV 事件流）、get_kv_connector_stats（指标）、handle_preemptions（抢占前保护异步保存中的块）</text>
</svg>

<h2 id="消费侧生命周期">
  <span class="i18n-zh">消费侧生命周期：一个请求怎么「等 KV」</span>
  <span class="i18n-en">Consumer-side lifecycle</span>
</h2>

<p>
  <span class="i18n-zh">以「新请求进来，外部缓存里有它的前缀」为例（<code>scheduler.py</code>）：<code>get_num_new_matched_tokens</code> 返回命中 token 数后，CacheManager 为这些 token 分配落地块并调 <code>update_state_after_alloc</code>；若命中声明为<strong>异步加载</strong>，请求进入 <code>WAITING_FOR_REMOTE_KVS</code> 状态挂起（不占 GPU 步），worker 在后台 <code>start_load_kv</code> 逐层拉取；每层加载完成后由 <code>KVConnectorOutput</code> 上报，调度器把它放回调度队列继续 prefill。<strong>失败路径</strong>是显式设计的：<code>get_block_ids_with_load_errors</code> 上报坏块，<code>kv_load_failure_policy</code> 二选一——<code>recompute</code>（把请求改期重算，默认倾向）或 <code>fail</code>（直接给请求报错结束）。</span>
</p>

<svg class="dg" viewBox="0 0 860 240" role="img" aria-label="消费侧 KV 加载状态流">
  <defs>
    <marker id="karr2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0L10,5L0,10z" class="arrp"/>
    </marker>
  </defs>
  <rect x="20" y="60" width="130" height="52" rx="8" class="b"/>
  <text x="85" y="82" text-anchor="middle" font-size="12">新请求到达</text>
  <text x="85" y="100" text-anchor="middle" font-size="11" class="ts">（或新增前缀）</text>
  <line x1="150" y1="86" x2="186" y2="86" class="ln" marker-end="url(#karr2)"/>
  <rect x="188" y="60" width="170" height="52" rx="8" class="ba"/>
  <text x="273" y="82" text-anchor="middle" font-size="12">① 命中查询</text>
  <text x="273" y="100" text-anchor="middle" font-size="11" class="ts">get_num_new_matched_tokens</text>
  <line x1="358" y1="86" x2="394" y2="86" class="ln" marker-end="url(#karr2)"/>
  <rect x="396" y="60" width="170" height="52" rx="8" class="b"/>
  <text x="481" y="82" text-anchor="middle" font-size="12">② 分配落地块</text>
  <text x="481" y="100" text-anchor="middle" font-size="11" class="ts">update_state_after_alloc</text>
  <line x1="566" y1="86" x2="602" y2="86" class="ln" marker-end="url(#karr2)"/>
  <rect x="604" y="60" width="150" height="52" rx="8" class="ba"/>
  <text x="679" y="82" text-anchor="middle" font-size="12">③ WAITING_FOR_REMOTE_KVS</text>
  <text x="679" y="100" text-anchor="middle" font-size="11" class="ts">异步拉取，不占 GPU 步</text>
  <path d="M679,112 L679,150 L500,150" class="ln" marker-end="url(#karr2)"/>
  <rect x="360" y="126" width="140" height="48" rx="8" class="bg"/>
  <text x="430" y="146" text-anchor="middle" font-size="12">④ 逐层加载完成</text>
  <text x="430" y="164" text-anchor="middle" font-size="11" class="ts">KVConnectorOutput 上报</text>
  <path d="M360,150 L200,150 L200,132" class="ln" marker-end="url(#karr2)"/>
  <rect x="100" y="80" width="0" height="0" class="b"/>
  <rect x="120" y="182" width="180" height="44" rx="8" class="bg"/>
  <text x="210" y="200" text-anchor="middle" font-size="12">⑤ 放回调度队列</text>
  <text x="210" y="218" text-anchor="middle" font-size="11" class="ts">从命中位置继续 prefill</text>
  <path d="M430,174 L430,204 L302,204" class="ln" marker-end="url(#karr2)"/>
  <rect x="560" y="182" width="150" height="44" rx="8" class="br"/>
  <text x="635" y="200" text-anchor="middle" font-size="12">加载失败（坏块上报）</text>
  <text x="635" y="218" text-anchor="middle" font-size="11" class="ts">kv_load_failure_policy</text>
  <text x="722" y="216" font-size="11" class="ts">recompute → 重算</text>
  <text x="722" y="232" font-size="11" class="ts">fail → 请求报错结束</text>
  <text x="20" y="30" font-size="12" class="ts">生产侧对称：save_kv_layer 逐层异步存 → wait_for_save 步末收尾 → request_finished 接管块异步保存 → get_finished 归还</text>
</svg>

<h2 id="接口约束">
  <span class="i18n-zh">接口里的隐性约束（容易踩的坑）</span>
  <span class="i18n-en">Implicit constraints</span>
</h2>

<ul>
  <li><strong>CUDA Graph</strong>：<span class="i18n-zh">用异步逐层 load/save 的 connector 必须 override <code>requires_piecewise_for_cudagraph()</code> 返回 True——这些操作不能被 graph 捕获，否则 replay 时被跳过产生数据竞争；PIECEWISE 模式让 Python 代码能在 graph 片段之间执行同步。</span></li>
  <li><strong>内存归属</strong>：<span class="i18n-zh"><code>request_finished</code> 返回 True 表示 connector 接管块的释放时机（异步保存中块不能被复用），直到 <code>get_finished</code> 归还；<code>requires_kv_delivery</code> 决定抢占时是否宁可重算也不能交出没送完的 KV。</span></li>
  <li><strong>HMA</strong>：<span class="i18n-zh">混合内存分配器（hybrid memory allocator，多 KV cache group）开启时，connector 必须实现 <code>SupportsHMA</code>，否则 factory 直接报错要求 <code>--disable-hybrid-kv-cache-manager</code>；MultiConnector 特殊处理——所有子 connector 都支持才算支持。</span></li>
  <li><strong>投机解码</strong>：<span class="i18n-zh">draft 之后的 <code>wait_for_save</code> 会被 defer（<code>defer_kv_connector_finalize</code>），所以 hook 文档明确写「每步调用一次，含空步、在 target 和 draft 前向之后」。</span></li>
  <li><strong>布局与睡眠</strong>：<span class="i18n-zh"><code>get_required_kvcache_layout</code> 可声明 HND/NHD 布局要求；sleep mode 下 <code>unregister_kv_caches / restore_kv_caches</code> 负责跟随显存重映射。</span></li>
</ul>

<h2 id="配置与内置实现">
  <span class="i18n-zh">配置面与 16 个内置实现</span>
  <span class="i18n-en">Config surface &amp; built-ins</span>
</h2>

<p>
  <span class="i18n-zh">入口是 <code>KVTransferConfig</code>（<code>--kv-transfer-config</code> 传入）：<code>kv_connector</code>（内置名或类名）、<code>kv_role</code>（<code>kv_producer / kv_consumer / kv_both</code>）、<code>kv_connector_module_path</code>（<strong>外部 connector 动态加载</strong>，优先于内置注册表，构造函数签名不对会直接报错）、<code>kv_connector_extra_config</code>（各 connector 自己的参数袋）、<code>kv_load_failure_policy</code>。请求级还有 <code>extra_args["kv_transfer_params"]</code>（如 <code>do_remote_prefill</code>、远端 block ids 等），供路由器/上游实例精确指挥。内置注册（<code>factory.py</code>）：</span>
</p>

<table class="srctable">
  <thead>
    <tr><th><span class="i18n-zh">注册名</span></th><th><span class="i18n-zh">场景</span></th></tr>
  </thead>
  <tbody>
    <tr><td><code>NixlConnector</code> / <code>NixlPullConnector</code> / <code>NixlPushConnector</code></td><td><span class="i18n-zh">PD 分离主力，NIXL 传输层，pull / push 两种方向（目录里 scheduler 与 worker 分文件：pull_scheduler/pull_worker…）</span></td></tr>
    <tr><td><code>MooncakeConnector</code> / <code>MooncakeStoreConnector</code></td><td><span class="i18n-zh">Mooncake 传输引擎 / 集中式 KV store</span></td></tr>
    <tr><td><code>LMCacheConnectorV1</code> / <code>LMCacheMPConnector</code></td><td><span class="i18n-zh">LMCache 分层缓存（单进程 / 多进程）</span></td></tr>
    <tr><td><code>MultiConnector</code></td><td><span class="i18n-zh">级联多个子 connector（按优先级依次问谁有命中），children 需全部支持 HMA</span></td></tr>
    <tr><td><code>OffloadingConnector</code> / <code>SimpleCPUOffloadConnector</code></td><td><span class="i18n-zh">GPU → CPU/分层介质卸载框架（offloading/ 目录含 scheduler/worker/events/metrics）</span></td></tr>
    <tr><td><code>HF3FSKVConnector</code> / <code>FlexKVConnectorV1</code> / <code>HiSparseConnector</code> / <code>MoRIIOConnector</code></td><td><span class="i18n-zh">3FS 存储 / FlexKV / 稀疏化 / RDMA 方案等生态接入</span></td></tr>
    <tr><td><code>ExampleConnector</code> / <code>ExampleHiddenStatesConnector</code> / <code>DecodeBenchConnector</code></td><td><span class="i18n-zh">官方模板（自己写 connector 从这抄骨架）/ 隐状态传输示例 / decode 基准</span></td></tr>
  </tbody>
</table>

<h2 id="与周报勾连">
  <span class="i18n-zh">与周报的勾连 &amp; 学习建议</span>
  <span class="i18n-en">Ties to the weekly tracker</span>
</h2>

<ul>
  <li><span class="i18n-zh">本周周报里的「KV Offload P2P 提速失败判定」（#63781）就是 NIXL P2P KV offload tier 的超时参数调优——机制本身在 <code>vllm/v1/kv_offload/</code>，connector 接口负责把它挂进调度。</span></li>
  <li><span class="i18n-zh">想自己写：从 <code>example_connector.py</code> 抄骨架，按上表 ①–⑧ 的顺序实现调度器侧四个 hook + worker 侧四个 hook，先用 <code>kv_connector_module_path</code> 外挂验证，跑通后再考虑进上游注册表。</span></li>
  <li><span class="i18n-zh">读源码顺序建议：<code>base.py</code>（接口）→ <code>example_connector.py</code>（最小实现）→ <code>offloading_connector.py</code>（异步保存/抢占保护的完整范例）→ <code>nixl/</code>（真实 PD 分离，pull/push 双模式）。</span></li>
</ul>

<p><em><span class="i18n-zh">基于 vLLM master @ 2026-10-28（接口标注 experimental，随时会变）；文件路径均在上游仓库核实。</span></em></p>
