---
layout: single
title: "vLLM"
permalink: /notes/vllm/
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
  .dg .cell  { fill: #c9d7f2; stroke: #7a97d4; }
  .dg .cellx { fill: #e3e5ea; stroke: #b9bcc4; }
  .dg .hi    { fill: #f7c8a8; stroke: #d97c2b; }
  html[data-theme="dark"] .dg .b  { fill: #2b3550; stroke: #6f8cc9; }
  html[data-theme="dark"] .dg .ba { fill: #41321b; stroke: #d9a04b; }
  html[data-theme="dark"] .dg .bg { fill: #1f3a2a; stroke: #5cb987; }
  html[data-theme="dark"] .dg .bb { fill: #2c2f36; stroke: #565b66; }
  html[data-theme="dark"] .dg text { fill: #ddd; }
  html[data-theme="dark"] .dg .ts { fill: #999; }
  html[data-theme="dark"] .dg .ln { stroke: #8a97ad; }
  html[data-theme="dark"] .dg .arrp { fill: #8a97ad; }
  html[data-theme="dark"] .dg .cell  { fill: #3b4a75; stroke: #6f8cc9; }
  html[data-theme="dark"] .dg .cellx { fill: #33363d; stroke: #565b66; }
  html[data-theme="dark"] .dg .hi    { fill: #5c3a1e; stroke: #e08b3d; }
  details.prwiki {
    border: 1px solid #ddd; border-radius: 8px; padding: 10px 16px;
    margin: 16px auto; max-width: 800px; background: #fff;
  }
  html[data-theme="dark"] details.prwiki { border-color: #444; background: #26282c; }
</style>

<p>
  <a href="/notes/"><span class="i18n-zh">← 返回学习笔记</span><span class="i18n-en">← Back to Study Notes</span></a>
</p>

<div class="i18n-en">
  <p><em>English quick summary: this page is a <strong>weekly tracker of upstream vLLM mechanisms</strong> — each week I read the newly merged PRs, pick the interesting mechanisms, and explain them in Chinese with a structure diagram and PR links. This week (2026-10-20 → 10-27): Triton-ized adaptive-verification budget selection, batch-sharded draft logits, Kimi-K3 KV-balanced MLA decode, and Fast Start weight-cache key hardening. (Diagrams are labeled in Chinese.)</em></p>
</div>

<h2 id="追踪说明">
  <span class="i18n-zh">追踪说明</span>
  <span class="i18n-en">How this tracker works</span>
</h2>

<ul>
  <li><span class="i18n-zh"><strong>每周一篇</strong>：覆盖最近 7 天（UTC）合入的 PR，最新的一期放最上面；往期归档在页底。</span></li>
  <li><span class="i18n-zh"><strong>来源</strong>：vllm-project/vllm 的 merged PR，按标题 + 正文人工筛选；每个机制都附 PR 链接，可溯源。</span></li>
  <li><span class="i18n-zh"><strong>筛选标准</strong>：新机制 / 性能机制优先；bugfix 只挑影响面大的；CI / 文档类只在快讯里带一句。</span></li>
  <li><span class="i18n-zh"><strong>图</strong>：每个机制配一张结构图（SVG，适配深色模式）；图与文中的数字均来自 PR 正文的自测数据，我未亲自复现。</span></li>
</ul>

<h2 id="week-2026-10-27">
  <span class="i18n-zh">本周：2026-10-20 → 10-27</span>
  <span class="i18n-en">This week: 2026-10-20 → 10-27</span>
</h2>

<p>
  <span class="i18n-zh">窗口内合入 500+ 个 PR（拉取上限 500，实际更多）。本周焦点是<strong>投机解码</strong>：自适应验证的性能与显存各补了一块。版本背景：<a href="https://github.com/vllm-project/vllm/releases/tag/v0.32.0">v0.32.0</a> 已于 10-18 发布，下面这些机制会进下一个 release。</span>
</p>

<h3 id="av-triton">1 · 自适应验证的「草稿预算选择」内核化 · <a href="https://github.com/vllm-project/vllm/pull/63421">#63421</a></h3>

<p>
  <span class="i18n-zh"><strong>自适应验证（Adaptive Verification, AV）</strong>是投机解码里每步<strong>动态决定草稿多少个 token</strong>的机制：预算 k′ 随上一步的接受情况变化，而不是固定草稿深度。问题在于预算选择原来用 <code>torch.compile(dynamic=True)</code> 实现——serving 中途会现场编译 4–5 个 Dynamo 图（每进程卡 1.8–4.7 秒），且每个预算绑定步的 host 开销高达 76–90µs。本 PR 把预算选择换成<strong>单次启动的 Triton 内核</strong>，warmup 时一次性 JIT：serving 中不再有编译，host 开销 ~15µs（约 6×），GPU 端 85–100µs → 22–30µs。实测 Qwen3-4B + DSpark、GSM8K、并发 16（H200）：4,783 → 6,803 tok/s（+42%），精度不变。</span>
</p>

<svg class="dg" viewBox="0 0 860 236" role="img" aria-label="自适应验证闭环结构图">
  <defs>
    <marker id="arr1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0L10,5L0,10z" class="arrp"/>
    </marker>
  </defs>
  <rect x="18" y="52" width="152" height="58" rx="8" class="b"/>
  <text x="94" y="76" text-anchor="middle" font-size="13">上一步验证结果</text>
  <text x="94" y="95" text-anchor="middle" font-size="12" class="ts">（接受长度等）</text>
  <line x1="170" y1="81" x2="206" y2="81" class="ln" marker-end="url(#arr1)"/>
  <rect x="208" y="44" width="212" height="74" rx="8" class="ba"/>
  <text x="314" y="68" text-anchor="middle" font-size="13">草稿预算选择内核</text>
  <text x="314" y="87" text-anchor="middle" font-size="12">Adaptive Verification</text>
  <text x="314" y="105" text-anchor="middle" font-size="12" class="ts">（Triton · 单次启动）</text>
  <line x1="420" y1="81" x2="456" y2="81" class="ln" marker-end="url(#arr1)"/>
  <rect x="458" y="52" width="168" height="58" rx="8" class="b"/>
  <text x="542" y="76" text-anchor="middle" font-size="13">草稿模型起草</text>
  <text x="542" y="95" text-anchor="middle" font-size="12">k′ 个 token</text>
  <line x1="626" y1="81" x2="662" y2="81" class="ln" marker-end="url(#arr1)"/>
  <rect x="664" y="52" width="178" height="58" rx="8" class="b"/>
  <text x="753" y="76" text-anchor="middle" font-size="13">目标模型批量验证</text>
  <text x="753" y="95" text-anchor="middle" font-size="12" class="ts">（rejection sampling）</text>
  <path d="M753,110 L753,168 L566,168" class="ln" marker-end="url(#arr1)"/>
  <rect x="396" y="140" width="170" height="56" rx="8" class="b"/>
  <text x="481" y="163" text-anchor="middle" font-size="13">接受 / 回滚</text>
  <text x="481" y="181" text-anchor="middle" font-size="12" class="ts">更新序列与统计</text>
  <path d="M396,168 L94,168 L94,110" class="ln" marker-end="url(#arr1)"/>
  <text x="20" y="205" font-size="12" class="ts">本周改动：torch.compile(dynamic=True) → Triton；预算步 host 76–90µs → ~15µs</text>
  <text x="20" y="224" font-size="12" class="ts">替代方案 #62539（启动期预编译 Dynamo）吞吐持平（6,756 tok/s），本 PR 直接消灭了编译环节</text>
</svg>

<h3 id="sharded-draft-logits">2 · 批分片采样下，draft logits 缓存也跟着分片 · <a href="https://github.com/vllm-project/vllm/pull/63554">#63554</a></h3>

<p>
  <span class="i18n-zh">vLLM 正在推进<strong>批分片采样（batch-sharded sampling）</strong>：目标模型的 logits 沿请求维分片到各 TP rank，请求按 <code>req_state_idx % tp_size</code> 归属，每个 rank 只对<strong>自己拥有的请求</strong>做采样与投机验证。但草稿模型的 logits 缓存此前仍按全量 <code>max_num_seqs</code> 行在每个 rank 上分配——批分片下每 rank 实际只用到 1/TP，其余全是白占的显存。本 PR 让每个 rank 只为自己要验证的请求分配 draft logits：行数 <code>max_num_seqs → ⌈max_num_seqs/tp⌉</code>，起草仍全量复制（保证 rank 间一致），读写统一走 <code>shard_owner / shard_row</code> 两个 Triton helper（单 TP 时编译退化回原行为）；省出的显存直接还给 KV cache。</span>
</p>

<svg class="dg" viewBox="0 0 860 252" role="img" aria-label="draft logits 分片前后对比图">
  <defs>
    <marker id="arr2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0L10,5L0,10z" class="arrp"/>
    </marker>
  </defs>
  <text x="18" y="26" font-size="13">改前：每个 rank 都分配全量 draft logits</text>
  <text x="452" y="26" font-size="13">改后：只存本 rank 负责验证的请求</text>
  <rect x="18" y="40" width="400" height="150" rx="8" class="b"/>
  <text x="218" y="62" text-anchor="middle" font-size="12">TP rank 0（max_num_seqs = 8 行，TP = 4）</text>
  <rect x="40"  y="76" width="42" height="40" rx="4" class="cell"/><text x="61"  y="100" text-anchor="middle" font-size="11">req0</text>
  <rect x="86"  y="76" width="42" height="40" rx="4" class="cellx"/><text x="107" y="100" text-anchor="middle" font-size="11">req1</text>
  <rect x="132" y="76" width="42" height="40" rx="4" class="cellx"/><text x="153" y="100" text-anchor="middle" font-size="11">req2</text>
  <rect x="178" y="76" width="42" height="40" rx="4" class="cellx"/><text x="199" y="100" text-anchor="middle" font-size="11">req3</text>
  <rect x="224" y="76" width="42" height="40" rx="4" class="cell"/><text x="245" y="100" text-anchor="middle" font-size="11">req4</text>
  <rect x="270" y="76" width="42" height="40" rx="4" class="cellx"/><text x="291" y="100" text-anchor="middle" font-size="11">req5</text>
  <rect x="316" y="76" width="42" height="40" rx="4" class="cellx"/><text x="337" y="100" text-anchor="middle" font-size="11">req6</text>
  <rect x="362" y="76" width="42" height="40" rx="4" class="cellx"/><text x="383" y="100" text-anchor="middle" font-size="11">req7</text>
  <text x="40" y="146" font-size="12">只有 req0 / req4 属于 rank 0（idx % 4 == 0），</text>
  <text x="40" y="166" font-size="12" class="ts">其余 (TP−1)/TP 的行是白占的显存</text>
  <rect x="452" y="40" width="390" height="150" rx="8" class="bg"/>
  <text x="647" y="62" text-anchor="middle" font-size="12">TP rank 0：只保留 2 行（⌈8/4⌉）</text>
  <rect x="480" y="76" width="52" height="40" rx="4" class="cell"/><text x="506" y="100" text-anchor="middle" font-size="11">req0</text>
  <rect x="540" y="76" width="52" height="40" rx="4" class="cell"/><text x="566" y="100" text-anchor="middle" font-size="11">req4</text>
  <text x="480" y="146" font-size="12">行号规则：row = req_state_idx // TP；</text>
  <text x="480" y="166" font-size="12" class="ts">读写全走 shard_owner / shard_row 两个 Triton helper</text>
  <line x1="647" y1="190" x2="647" y2="212" class="ln" marker-end="url(#arr2)"/>
  <rect x="510" y="214" width="274" height="30" rx="8" class="bg"/>
  <text x="647" y="234" text-anchor="middle" font-size="12">省出的显存 → 还给 KV cache</text>
  <text x="18" y="234" font-size="12" class="ts">起草仍全量复制（rank 间一致性），仅缓存分片</text>
</svg>

<h3 id="kv-balanced-mla">3 · Kimi-K3「按请求长度均衡」的 FP8 MLA decode · <a href="https://github.com/vllm-project/vllm/pull/63638">#63638</a></h3>

<p>
  <span class="i18n-zh">Agent 类负载的特点是<strong>同一批里请求的上下文长度差异极大</strong>（有的刚开头、有的已经滚了几万 token），decode attention 的负载随之失衡，整批被最长的请求拖住。新后端 <code>--attention-backend KIMI_K3_KV_BALANCED_MLA</code>（Blackwell，opt-in）按<strong>每个请求自身的长度比例</strong>切分它的 KV，让各 GPU 的 decode 工作量重新均衡。实测（GB300，AgentX 长度分布）：decode attention 相对 TOKENSPEED_MLA（min_split_kv=8）1.34–1.59×、相对其默认配置 1.91–2.67×；端到端 DEP16 decode（3P1D）：+7.8% TPS/GPU、p90 交互时延改善 20%。</span>
</p>

<svg class="dg" viewBox="0 0 860 262" role="img" aria-label="KV 均衡切分前后对比图">
  <text x="18" y="26" font-size="13">默认：每请求固定切分 → 长请求压垮个别 GPU</text>
  <text x="452" y="26" font-size="13">KV-balanced：按各请求自身长度切分 → 均衡</text>
  <rect x="40" y="80" width="60" height="34"  class="b"/>  <text x="70" y="102" text-anchor="middle" font-size="12">GPU1</text>
  <rect x="116" y="60" width="60" height="54"  class="b"/>  <text x="146" y="102" text-anchor="middle" font-size="12">GPU2</text>
  <rect x="192" y="34" width="60" height="80"  class="b"/>  <text x="222" y="102" text-anchor="middle" font-size="12">GPU3</text>
  <rect x="268" y="34" width="60" height="140" class="hi"/> <text x="298" y="110" text-anchor="middle" font-size="12">GPU4</text>
  <line x1="30" y1="174" x2="420" y2="174" class="ln"/>
  <text x="70" y="194" text-anchor="middle" font-size="12" class="ts">短</text>
  <text x="146" y="194" text-anchor="middle" font-size="12" class="ts">中</text>
  <text x="222" y="194" text-anchor="middle" font-size="12" class="ts">较长</text>
  <text x="298" y="194" text-anchor="middle" font-size="12" class="ts">最长请求 → 整批等它</text>
  <rect x="470" y="60" width="80" height="114" class="bg"/> <text x="510" y="102" text-anchor="middle" font-size="12">GPU1</text>
  <rect x="560" y="60" width="80" height="114" class="bg"/> <text x="600" y="102" text-anchor="middle" font-size="12">GPU2</text>
  <rect x="650" y="60" width="80" height="114" class="bg"/> <text x="690" y="102" text-anchor="middle" font-size="12">GPU3</text>
  <rect x="740" y="60" width="80" height="114" class="bg"/> <text x="780" y="102" text-anchor="middle" font-size="12">GPU4</text>
  <line x1="460" y1="174" x2="850" y2="174" class="ln"/>
  <text x="655" y="194" text-anchor="middle" font-size="12" class="ts">decode 工作量被拉平（柱高 = 每 GPU 的 attention 负载）</text>
  <text x="18" y="226" font-size="12" class="ts">批内上下文长度差异越大收益越大（agent 场景）；GB300 decode attention 1.34–1.59× / 默认 1.91–2.67×，DEP16 端到端 +7.8% TPS/GPU</text>
  <text x="18" y="246" font-size="12" class="ts">构建在 MLACommonBackend 等公共类上，代码位于 vllm/models/kimi_k3/nvidia/kv_balanced_mla/</text>
</svg>

<h3 id="fast-start-cache-key">4 · Fast Start：权重缓存 key 补上「内核后端」维度 · <a href="https://github.com/vllm-project/vllm/pull/63506">#63506</a></h3>

<p>
  <span class="i18n-zh"><strong>Fast Start</strong>（路线图 <a href="https://github.com/vllm-project/vllm/pull/56049">#56049</a>）的思路：由常驻守护进程（daemon）把权重<strong>预处理一次</strong>（<code>process_weights_after_loading</code>：量化、shuffle、repack 成所选内核后端的布局），后续 engine 启动直接走 IPC 共享内存映射，跳过加载与预处理。坑在于：<code>WeightCacheKey</code> 里没有 <code>--moe-backend / --linear-backend</code>——daemon 用 CUTLASS 布局处理好的权重，可能被一个解析成 TRT-LLM 后端的 engine 映射走，<code>/health</code> 照样 200，但<strong>每个输出都是错的</strong>。本 PR 把 <code>moe_backend、linear_backend、linear_backend_per_quant</code> 加进 key（取「配置值」而非「解析值」，保守策略），后端不匹配时先报 key miss，再按默认 <code>fallback=true</code> 回退磁盘加载。</span>
</p>

<svg class="dg" viewBox="0 0 860 292" role="img" aria-label="Fast Start 权重缓存结构图">
  <defs>
    <marker id="arr4" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0L10,5L0,10z" class="arrp"/>
    </marker>
  </defs>
  <rect x="18" y="46" width="264" height="118" rx="8" class="b"/>
  <text x="150" y="68" text-anchor="middle" font-size="13">常驻权重守护进程（daemon）</text>
  <text x="34" y="92" font-size="12">① 加载原始权重</text>
  <text x="34" y="112" font-size="12">② process_weights_after_loading：</text>
  <text x="48" y="131" font-size="12" class="ts">量化 / shuffle / repack 成后端布局</text>
  <text x="34" y="151" font-size="12">③ 按 key 写入共享缓存（只做一次）</text>
  <line x1="282" y1="105" x2="326" y2="105" class="ln" marker-end="url(#arr4)"/>
  <rect x="328" y="52" width="216" height="106" rx="8" class="ba"/>
  <text x="436" y="74" text-anchor="middle" font-size="13">共享权重缓存</text>
  <text x="436" y="92" text-anchor="middle" font-size="12">WeightCacheKey =</text>
  <text x="436" y="110" text-anchor="middle" font-size="12">{model, quant,</text>
  <text x="436" y="128" text-anchor="middle" font-size="12">moe_backend, linear_backend,</text>
  <text x="436" y="146" text-anchor="middle" font-size="12" class="ts">linear_backend_per_quant, …}</text>
  <rect x="606" y="46" width="236" height="58" rx="8" class="b"/>
  <text x="724" y="70" text-anchor="middle" font-size="13">Engine 启动</text>
  <text x="724" y="89" text-anchor="middle" font-size="12" class="ts">（自带 --moe-backend 等配置）</text>
  <line x1="724" y1="104" x2="724" y2="128" class="ln" marker-end="url(#arr4)"/>
  <rect x="606" y="130" width="236" height="52" rx="8" class="b"/>
  <text x="724" y="152" text-anchor="middle" font-size="12">用自己的配置计算 WeightCacheKey</text>
  <text x="724" y="171" text-anchor="middle" font-size="12">去缓存里匹配</text>
  <path d="M680,182 L680,222 L596,222" class="ln" marker-end="url(#arr4)"/>
  <path d="M768,182 L768,220" class="ln" marker-end="url(#arr4)"/>
  <text x="640" y="212" font-size="12" class="ts">命中</text>
  <text x="778" y="212" font-size="12" class="ts">未命中</text>
  <rect x="420" y="224" width="176" height="48" rx="8" class="bg"/>
  <text x="508" y="244" text-anchor="middle" font-size="12">命中：IPC mmap 零拷贝</text>
  <text x="508" y="262" text-anchor="middle" font-size="12" class="ts">跳过加载与预处理</text>
  <rect x="620" y="224" width="196" height="48" rx="8" class="bb"/>
  <text x="718" y="244" text-anchor="middle" font-size="12">未命中：回退磁盘加载</text>
  <text x="718" y="262" text-anchor="middle" font-size="12" class="ts">（fallback=true，默认）</text>
  <text x="18" y="244" font-size="12" class="ts">本周 #63506：key 原来缺内核后端 →</text>
  <text x="18" y="263" font-size="12" class="ts">后端不同的 engine 映射到错误布局权重，</text>
  <text x="18" y="282" font-size="12" class="ts">/health 200 但输出全错；现先报 miss 再回退</text>
</svg>

<h3 id="quick-hits">
  <span class="i18n-zh">快讯</span>
  <span class="i18n-en">Quick hits</span>
</h3>

<ul>
  <li><strong>MRv2 基建</strong>：<a href="https://github.com/vllm-project/vllm/pull/63633">#63633</a> — StagedWriteTensor 按<strong>引用 staging + UVA 直读</strong>：numpy / array.array 零拷贝进 UVA buffer，写内核对 GPU 侧目标也走 UVA，mrope positions 的 stage+apply 从 4–13ms 降到 ~65µs（GB200）。</li>
  <li><strong>KV Offload P2P 提速失败判定</strong>：<a href="https://github.com/vllm-project/vllm/pull/63781">#63781</a> — 卡死对端的故障判定从 ~40s 压到 ~15s（symmetric-P2P load 30→10s、abort-ack 10→5s、lookup 无进展 30→8s；PD 负载保留 30s 给完整 prefill），失败后本地重算。</li>
  <li><strong>Rust 前端对齐周</strong>：<a href="https://github.com/vllm-project/vllm/pull/63313">#63313</a>–<a href="https://github.com/vllm-project/vllm/pull/63318">#63318</a> 等 8+ 个 PR，把 Rust 版 API server 的行为逐项对齐 Python 前端（bad words、logit_bias 校验、LoRA、Mooncake 指标……）。</li>
  <li><strong>退役</strong>：结构化输出后端 <strong>LM Format Enforcer</strong> 被弃用（<a href="https://github.com/vllm-project/vllm/pull/63423">#63423</a>）；实验性的 <strong>vLLM IR</strong> 开始做移除前的清理（<a href="https://github.com/vllm-project/vllm/pull/63371">#63371</a>）。</li>
  <li><strong>生态</strong>：NIXL 升 1.5.1（<a href="https://github.com/vllm-project/vllm/pull/63817">#63817</a>）；DeepGEMM MegaMoE、AgentX 调优 preset（Kimi-K3 / DeepSeek-V4.1 / MiniMax-M3 系列 recipe）持续滚动。</li>
</ul>

<h2 id="archive">
  <span class="i18n-zh">往期周报</span>
  <span class="i18n-en">Past weeks</span>
</h2>

<p>
  <span class="i18n-zh">暂无。从下一周起，旧的一期会挪到这里归档。</span>
  <span class="i18n-en">Empty for now; each week the previous entry moves here.</span>
</p>

<details class="prwiki" markdown="1">
<summary><strong><span class="i18n-zh">背景速览</span><span class="i18n-en">Background primer</span></strong>（<span class="i18n-zh">PagedAttention / 连续批处理 / 架构 / 常用参数 / 学习路线 —— 点开查看</span><span class="i18n-en">PagedAttention, continuous batching, architecture, parameters, learning path</span>）</summary>

### 一句话定位

vLLM 由 UC Berkeley 开源，凭借 <strong>PagedAttention</strong> 一战成名，是目前工业界应用最广的开源 LLM 推理引擎之一，主打高吞吐服务（throughput-oriented serving）。

### 核心机制

- <strong>PagedAttention（SOSP 2023）</strong>：把 KV cache 切成固定大小的 block（典型 16 token/块），用「逻辑块 → 物理块」映射表分页管理、按需分配，几乎消灭显存碎片（论文数据：KV 显存浪费从 60–80% 降到 4% 以下）；序列间相同前缀通过 copy-on-write 共享物理块。
- <strong>Continuous batching（连续批处理）</strong>：调度粒度是引擎的每一步（iteration 级）：请求随到随进批、做完立刻退出、空位马上补新请求。思路源自 Orca。
- <strong>Automatic Prefix Caching（APC）</strong>：对每个 KV block 按内容哈希，相同前缀的请求直接复用已算好的 KV（新版本默认开启）。
- <strong>Chunked prefill</strong>：超长 prompt 的 prefill 切成多个 chunk 与 decode 混批，避免一个长请求阻塞其他请求的时延。
- <strong>投机解码</strong>：内置 ngram、draft model、Medusa、EAGLE、DSpark、DFlash 等方案，以及自适应验证（AV）等增强——本页周报持续追踪这块。
- <strong>量化与并行</strong>：FP8/INT8/AWQ/GPTQ/NVFP4/MXFP8 等量化；TP/PP/EP/DP 并行与 PD 分离等（以官方文档为准）。

### 架构与源码入口（V1 引擎）

- <code>AsyncLLM</code>：异步 API 层；<code>EngineCore</code>：独立引擎进程，主循环 = schedule → execute → update。
- <code>Scheduler</code>（<code>vllm/v1/core/sched/</code>）：每步决定哪些请求进批、分配/回收哪些 block。
- <code>Executor / Worker / ModelRunner</code>：多进程执行；GPU 侧负责前向、采样与 CUDA Graph 捕获（MRv2 正在重构这一层）。
- <code>vllm/entrypoints/openai/</code>：OpenAI 兼容 API server。

### 上手与常用参数

```bash
pip install vllm
# 启动 OpenAI 兼容服务
vllm serve Qwen/Qwen2.5-7B-Instruct --tensor-parallel-size 2 --max-model-len 32768
# 压测（新版本）：vllm bench serve；旧版本用仓库内 benchmarks/benchmark_serving.py
```

| <span class="i18n-zh">参数</span><span class="i18n-en">Parameter</span> | <span class="i18n-zh">作用</span><span class="i18n-en">Effect</span> |
| --- | --- |
| `--tensor-parallel-size` | 张量并行卡数 |
| `--gpu-memory-utilization` | 显存占用上限（KV cache 预算由此而来） |
| `--max-model-len` / `--max-num-seqs` | 最大上下文 / 最大并发序列 |
| `--enable-prefix-caching` | 前缀缓存（新版本默认开启） |
| `--speculative-config` | 投机解码配置（方法/草稿模型/步长等） |
| `--attention-backend` / `--moe-backend` | 选择 attention / MoE 内核后端（本周 #63638、#63506 都和它有关） |

### 学习路线

1. 精读 PagedAttention 论文（SOSP 2023）。
2. 本地跑通 serve + 压测（<code>vllm bench serve</code>），观察 TTFT / ITL / 吞吐的相互制约。
3. 读 <code>vllm/v1/core/sched/</code> 调度器源码，跟一遍「一个请求的一生」。
4. 对照本页周报，挑一个新机制去源码里找实现——周报里的 PR 号就是入口。

### 论文与资料

- <em>Efficient Memory Management for Large Language Model Serving with PagedAttention</em>（SOSP 2023）
- 官方文档：docs.vllm.ai；release notes（双周节奏）

</details>

<p><em><span class="i18n-zh">追踪窗口 2026-10-20 → 10-27（UTC）；文中数字来自各 PR 正文自测，未亲自复现。引擎迭代快，以官方文档为准。</span></em></p>
