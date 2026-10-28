---
layout: single
title: "Speculative Decoding"
permalink: /notes/spec-decoding/
author_profile: true
---

<style>
  .dg { width: 100%; height: auto; display: block; margin: 8px 0 2px; }
  .dg .b  { fill: #eef3fd; stroke: #7a97d4; stroke-width: 1.2; }
  .dg .ba { fill: #fff3e0; stroke: #e0a04a; stroke-width: 1.4; }
  .dg .bg { fill: #e9f6ee; stroke: #59a97c; stroke-width: 1.2; }
  .dg .bb { fill: #f2f2f4; stroke: #b9bcc4; stroke-width: 1; }
  .dg .br { fill: #fdeaea; stroke: #d98a8a; stroke-width: 1.2; }
  .dg .cell { fill: #ffffff; stroke: #7a97d4; }
  .dg .cellok { fill: #c9e7d2; stroke: #59a97c; }
  .dg .cellno { fill: #f6d3d3; stroke: #d98a8a; }
  .dg text { fill: #333; font-family: inherit; }
  .dg .ts { fill: #666; }
  .dg .ln { stroke: #7a879d; stroke-width: 1.4; fill: none; }
  .dg .arrp { fill: #7a879d; }
  html[data-theme="dark"] .dg .b  { fill: #2b3550; stroke: #6f8cc9; }
  html[data-theme="dark"] .dg .ba { fill: #41321b; stroke: #d9a04b; }
  html[data-theme="dark"] .dg .bg { fill: #1f3a2a; stroke: #5cb987; }
  html[data-theme="dark"] .dg .bb { fill: #2c2f36; stroke: #565b66; }
  html[data-theme="dark"] .dg .br { fill: #452525; stroke: #c97a7a; }
  html[data-theme="dark"] .dg .cell { fill: #303550; stroke: #6f8cc9; }
  html[data-theme="dark"] .dg .cellok { fill: #274a35; stroke: #5cb987; }
  html[data-theme="dark"] .dg .cellno { fill: #4a2a2a; stroke: #c97a7a; }
  html[data-theme="dark"] .dg text { fill: #ddd; }
  html[data-theme="dark"] .dg .ts { fill: #999; }
  html[data-theme="dark"] .dg .ln { stroke: #8a97ad; }
  html[data-theme="dark"] .dg .arrp { fill: #8a97ad; }
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
    <li><span class="i18n-zh">核心循环：小模型连猜 k 个 token（k＝每轮猜的个数，叫<strong>草稿深度</strong>），大模型<strong>一次前向并行验证</strong>——本来要串行跑 k+1 次大模型前向，压缩成「小模型 k 次 + 大模型 1 次」。</span></li>
    <li><span class="i18n-zh"><strong>输出分布不变</strong>：拒绝采样保证每个最终 token 的分布与只跑大模型完全一致——数学上无损。</span></li>
    <li><span class="i18n-zh">工程难点在<strong>状态管理</strong>：目标 KV、草稿 KV、隐藏状态三套状态，都要按「验证接受到哪」精确回退或复用。</span></li>
    <li><span class="i18n-zh">收益是接受率 α 的函数：E[每步产出] = (1−α^(k+1))/(1−α)；α 低或草稿太贵就是负收益 → 这就是自适应深度（AV）要解决的问题。</span></li>
  </ul>
</div>

<h2 id="先统一几个词">
  <span class="i18n-zh">先统一几个词</span>
  <span class="i18n-en">Terms first</span>
</h2>

<table class="srctable">
  <tbody>
    <tr><td><strong>KV cache（<span class="i18n-zh">键值缓存</span>）</strong></td><td><span class="i18n-zh">模型为已生成的每个 token 缓存的注意力中间结果，生成每个新 token 都要读它</span></td></tr>
    <tr><td><strong><span class="i18n-zh">草稿深度</span> k</strong></td><td><span class="i18n-zh">每轮草稿猜的 token 个数</span></td></tr>
    <tr><td><strong>q / p</strong></td><td><span class="i18n-zh">同一个「下一个 token 是谁」的概率分布：q 是草稿模型给的，p 是目标模型给的</span></td></tr>
    <tr><td><strong><span class="i18n-zh">接受率</span> α</strong></td><td><span class="i18n-zh">草稿 token 平均被接受的比例（0～1）</span></td></tr>
    <tr><td><strong>bonus token</strong></td><td><span class="i18n-zh">k 个草稿全部被接受后，目标模型从最后一位分布里多采的那 1 个 token（白送的）</span></td></tr>
    <tr><td><strong><span class="i18n-zh">自回归</span></strong></td><td><span class="i18n-zh">一个一个往右生成：每出新 token 都把它当输入接着出下一个</span></td></tr>
    <tr><td><strong>EAGLE / MTP / Medusa</strong></td><td><span class="i18n-zh">三类「借大模型隐状态出草稿」的方案名，正文有对比表</span></td></tr>
    <tr><td><strong>first pass</strong></td><td><span class="i18n-zh">每轮起草的第一个前向：把上轮位置重放一遍，让草稿模型的隐状态和 KV 接上</span></td></tr>
    <tr><td><strong>TP / rank</strong></td><td>TP＝<span class="i18n-zh">张量并行（一层切到多卡算）；rank＝卡/进程在并行组里的编号</span></td></tr>
  </tbody>
</table>

<h2 id="一句话定位">
  <span class="i18n-zh">一句话定位</span>
  <span class="i18n-en">What it is</span>
</h2>

<p>
  <span class="i18n-zh">自回归解码每步只产 1 个 token，GPU 一次前向大部分算力花在「搬权重」上，batch 一小就吃不饱。投机解码让<strong>小草稿模型（或 n-gram、附加头）先猜一段</strong>，再让<strong>大模型一次前向并行验证</strong>：验证是一次批处理前向，算力花得值；猜对的部分白赚。前提是<strong>草稿与目标共用词表和分词器</strong>（token id 与 embedding 空间一致），否则无法逐位验证。</span>
</p>

<h2 id="核心循环">
  <span class="i18n-zh">核心循环：token 级走一遍</span>
  <span class="i18n-en">The core loop, token by token</span>
</h2>

<p>
  <span class="i18n-zh">设已生成序列「中国的首都是」，草稿深度 k=3：</span>
</p>

<ol>
  <li><strong><span class="i18n-zh">草稿阶段</span></strong>：<span class="i18n-zh">草稿模型自回归（每猜出一个就把猜测当输入继续猜）连猜 3 个 token：「北京」「的」「冬天」，每个带草稿概率 q。草稿每猜一个，就要把自己的 KV 写进<strong>草稿自己的 KV cache</strong>（草稿是完整的小模型时）。</span></li>
  <li><strong><span class="i18n-zh">验证阶段</span></strong>：<span class="i18n-zh">目标模型<strong>一次前向</strong>吃进 6 个位置「中国的首都是 北京 的 冬天」，并行产出 4 组分布 p₁…p₄——注意大模型只跑了 1 次前向，这是全部收益的来源。</span></li>
  <li><strong><span class="i18n-zh">逐位验证</span></strong>：<span class="i18n-zh">从左到右逐位决定接受或拒绝（数学见下节）：</span>
    <ul>
      <li><span class="i18n-zh">位置 1：p₁(北京)=0.92，q=0.9 → 接受概率 min(1, 0.92/0.9)=1 → 接受「北京」；</span></li>
      <li><span class="i18n-zh">位置 2：p₂(的)=0.7，q=0.9 → 接受概率 0.7/0.9≈0.78 → 抽签，本例接受「的」；</span></li>
      <li><span class="i18n-zh">位置 3：p₃(冬天)=0.05，q=0.6 → 接受概率 0.083 → 抽签拒绝 → <strong>从修正分布 norm(max(0, p₃−q)) 重采一个（如「春」），本步结束</strong>，草稿「城市」整段丢弃；</span></li>
      <li><span class="i18n-zh">位置 4 的 bonus 不再采样——因为位置 3 已拒绝，本步到此为止。</span></li>
    </ul>
  </li>
  <li><span class="i18n-zh"><strong>本步净产出</strong>：「北京」「的」「春」3 个 token，而目标模型只跑了一次前向。若 3 个草稿全对：净产出 4 个（3 草稿 + 1 bonus，bonus 从 p₄ 采样）。</span></li>
</ol>

<div class="diagram-fig">
  <img src="/files/diagrams/export/spec-01-d.svg" alt="草稿-验证一次迭代示意图">
</div>

<h2 id="拒绝采样数学">
  <span class="i18n-zh">拒绝采样的数学：为什么分布不变</span>
  <span class="i18n-en">The math: why the distribution is unchanged</span>
</h2>

<ul>
  <li><span class="i18n-zh">草稿分布 q、目标分布 p，同一 token x：接受概率 <code>min(1, p(x)/q(x))</code>。贪心解码（temperature=0）退化为<strong>逐位比对</strong>，一致即接受。</span></li>
  <li><span class="i18n-zh">在位置 i 被拒绝时，从<strong>修正分布</strong> <code>norm(max(0, p−q))</code> 重采一个 token——这个分布恰好把「p 比 q 多出来的概率质量」补回去。</span></li>
  <li><span class="i18n-zh">三者拼接可证明：最终 token 严格服从 p。<strong>这是「无损」的数学含义</strong>：加速不改变输出分布，改变的只是每步产出 token 的期望数量。</span></li>
  <li><span class="i18n-zh">设平均接受率 α，深度 k，则 E[每步产出] = (1−α^(k+1))/(1−α)：α=0.8 时 k=3 约 2.95 个/步、k=5 约 3.69 个/步；α=0.3 时收益迅速缩水，草稿前向本身的开销（约为目标的 1/c）会把净收益吃成负数——<strong>k 不是越大越好</strong>，这就是自适应验证（AV）动态调深度的动机。</span></li>
  <li><span class="i18n-zh">工程实现里验证还要带上采样约束：vLLM 的 <code>RejectionSampler</code> 把 min_tokens、重复惩罚、bad words、top-k/top-p 全部应用在草稿验证上，保证带约束解码也分布无损。</span></li>
</ul>

<h2 id="状态管理">
  <span class="i18n-zh">状态管理：三套状态怎么回退（工程难点）</span>
  <span class="i18n-en">State management: the engineering hard part</span>
</h2>

<table class="srctable">
  <thead><tr><th><span class="i18n-zh">状态</span></th><th><span class="i18n-zh">验证时发生什么</span></th><th><span class="i18n-zh">回退 / 复用</span></th></tr></thead>
  <tbody>
    <tr>
      <td><strong><span class="i18n-zh">目标 KV cache</span></strong></td>
      <td><span class="i18n-zh">验证前向把 k 个草稿 token 的 KV 一并写入块（本来就要算这些位置）</span></td>
      <td><span class="i18n-zh">拒绝的尾部按 <code>num_rejected_tokens</code> 回退块占用；接受的前缀原样保留，下一轮直接续用</span></td>
    </tr>
    <tr>
      <td><strong><span class="i18n-zh">草稿 KV cache</span></strong></td>
      <td><span class="i18n-zh">草稿自己的层各自缓存草稿 token 的 KV（独立小模型 / EAGLE 头有自己的注意力）</span></td>
      <td><span class="i18n-zh">被接受的 m 个草稿条目<strong>仍然有效</strong>；只对被拒的 k−m 条做<strong>逻辑回退</strong>（<code>seq_lens -= num_rejected_tokens</code>、槽位打掩码，不搬数据），下轮起草的第一个前向（first pass）在原槽位原地重写，并把新采样的 bonus/重采 token 补进草稿链</span></td>
    </tr>
    <tr>
      <td><strong><span class="i18n-zh">隐藏状态</span></strong></td>
      <td><span class="i18n-zh">标准拒绝采样中，大小模型<strong>各算各的 hidden states</strong>，互不传递；验证接受到位置 i，目标模型在位置 i 的 last hidden state 恰好就是「继续生成」所需状态</span></td>
      <td><span class="i18n-zh">基于隐状态的方案（EAGLE / MTP）直接<strong>复用目标模型已算好的 hidden state</strong> 给草稿当输入，不用重算——这是这类方法省草稿前向的关键，也是「aux hidden state 精度」这类工程细节的来源（如 DFlash #63436 用 draft dtype 跑 aux FC）</span></td>
    </tr>
  </tbody>
</table>

<h3 id="草稿-kv-回退的精确含义">
  <span class="i18n-zh">「回退」的精确含义与开销</span>
  <span class="i18n-en">What rollback actually means</span>
</h3>

<p>
  <span class="i18n-zh">以独立小模型为例（vLLM <code>llm_base_proposer.py</code>）：验证接受 m 个、拒绝 k−m 个后，草稿 KV 里<strong>只有被拒的 k−m 个条目失效</strong>（序列在那之后分叉），接受前缀的条目依然有效；新采样的 bonus/重采 token 则还没有草稿 KV。回退本身是<strong>逻辑的、零数据搬运</strong>：<code>seq_lens -= num_rejected_tokens_gpu</code> + 被拒槽位打掩码（slot 置 −1）。下一轮起草的第一个前向（first pass）把上轮 k+1 个位置整体重放一遍（输入左移一位、末位插入新采样 token，被拒槽位原地重写）——这次前向每轮本来就要跑，其中被拒 (k−m) 个位置是必要的重写，接受 m 个位置是确定性冗余重算（纯为让每轮输入形状统一，能用 CUDA graph 整图重放），真正的增量只有新采样那 1 个 token 的小模型前向。EAGLE 系更省：hidden states 直接从目标验证前向接力（<code>hidden_states[:] = target_hidden_states</code>），连草稿隐状态的重算都省了。「物理回退 + 从头重放整条前缀」（每轮多 m+1 个位置 + 块级搬移）是朴素实现的做法，vLLM 避开了。</span>
</p>

<h2 id="hidden-states-流动">
  <span class="i18n-zh">hidden states 在大小模型之间的流动</span>
  <span class="i18n-en">Hidden-state flow between draft and target</span>
</h2>

<p>
  <span class="i18n-zh">草稿信号源分三代，差别就在「拿什么当输入」：</span>
</p>

<table class="srctable">
  <thead><tr><th><span class="i18n-zh">方案</span></th><th><span class="i18n-zh">草稿信号源</span></th><th><span class="i18n-zh">hidden state 的角色</span></th></tr></thead>
  <tbody>
    <tr><td><strong>n-gram / prompt lookup</strong></td><td><span class="i18n-zh">已生成文本里的重复模式，无模型</span></td><td><span class="i18n-zh">完全不涉及</span></td></tr>
    <tr><td><strong><span class="i18n-zh">独立草稿小模型</span></strong></td><td><span class="i18n-zh">草稿自己的 hidden states，自回归 k 次</span></td><td><span class="i18n-zh">与目标模型无关，两套 KV 独立维护</span></td></tr>
    <tr><td><strong>EAGLE / EAGLE-3</strong></td><td><span class="i18n-zh">草稿头在<strong>特征级</strong>自回归</span></td><td><span class="i18n-zh">草稿头消费<strong>目标模型的 hidden state</strong>：输入 = 目标 last hidden state（EAGLE-3 还拼接若干中间层的辅助隐状态 aux hidden states，经全连接层投影融合）+ 下一 token 的 embedding → 预测再下一个 token</span></td></tr>
    <tr><td><strong>MTP</strong>（Multi-Token Prediction，<span class="i18n-zh">DeepSeek-V3 引入的多 token 预测</span>）</td><td><span class="i18n-zh">附加的 MTP 模块一次预测多步</span></td><td><span class="i18n-zh">输入 = 目标 hidden state + 下一 token embedding；每个深度一个 MTP 模块，有自己的 embedding / 投影 / 头</span></td></tr>
    <tr><td><strong>Medusa / 多头</strong></td><td><span class="i18n-zh">目标骨干上的多个解码头 + 树注意力</span></td><td><span class="i18n-zh">头直接挂在目标顶层 hidden state 上，无独立草稿模型</span></td></tr>
    <tr><td><strong>LayerSkip / 自投机</strong></td><td><span class="i18n-zh">用目标模型前几层提前退出</span></td><td><span class="i18n-zh">早期层的 hidden states 就是草稿信号，同一套权重</span></td></tr>
  </tbody>
</table>

<div class="diagram-fig">
  <img src="/files/diagrams/export/spec-02-d.svg" alt="目标 hidden state 流向草稿模型示意图">
</div>

<h2 id="vllm-实现定位">
  <span class="i18n-zh">vLLM V1 的实现细节（源码定位）</span>
  <span class="i18n-en">vLLM V1 implementation map</span>
</h2>

<table class="srctable">
  <thead><tr><th><span class="i18n-zh">环节</span></th><th><span class="i18n-zh">实现</span></th></tr></thead>
  <tbody>
    <tr><td><span class="i18n-zh">草稿提议（ngram）</span></td><td><code>vllm/v1/spec_decode/ngram_proposer.py</code>：<span class="i18n-zh">numba 在 CPU 上对 <code>token_ids_cpu</code> 数组做后缀匹配（<code>prompt_lookup_min/max</code>），预分配 numpy buffer，多线程上限按 TP 均分</span></td></tr>
    <tr><td><span class="i18n-zh">草稿提议（EAGLE 系）</span></td><td><code>eagle.py</code> + <code>llm_base_proposer.py</code>：<code>pass_hidden_states_to_model=True</code>；EAGLE-3 拼接 aux hidden states；DSpark / DFlash 同基类</td></tr>
    <tr><td><span class="i18n-zh">隐状态提取器</span></td><td><code>extract_hidden_states.py</code>：<span class="i18n-zh">消费目标前向 hidden states 的独立 proposer（MTP 风格，num_spec_tokens=1，自带 kv_cache_gid 与 attention metadata builder）</span></td></tr>
    <tr><td><span class="i18n-zh">批量拒绝采样</span></td><td><code>vllm/v1/sample/rejection_sampler.py</code>：<span class="i18n-zh">Triton 内核（JIT warmup），<code>MAX_SPEC_LEN=128</code>，把采样约束（penalties / bad words / top-k top-p）应用在草稿验证上</span></td></tr>
    <tr><td><span class="i18n-zh">草稿深度选择</span></td><td><span class="i18n-zh">自适应验证（AV）按上一步接受情况动态定 k′（本轮猜几个），预算选择已写成 Triton GPU 内核（<code>dynamic/</code> 目录，本周 #63421）</span></td></tr>
    <tr><td><span class="i18n-zh">显存分片</span></td><td><span class="i18n-zh">批分片采样（batch-sharded sampling：把请求分给各 TP rank 各自验证）下，draft logits 每 rank 只存自己负责的请求（本周 #63554，<code>shard_owner / shard_row</code>）</span></td></tr>
    <tr><td><span class="i18n-zh">回退</span></td><td><span class="i18n-zh">GPU 侧按 <code>num_rejected_tokens</code> 回退块占用，调度器按 <code>spec_decode_tokens</code> 对账占位符</span></td></tr>
  </tbody>
</table>

<h2 id="常见误区">
  <span class="i18n-zh">常见误区</span>
  <span class="i18n-en">Common misconceptions</span>
</h2>

<ul>
  <li><span class="i18n-zh"><strong>「目标模型要跑 k+1 次前向」</strong>——错。草稿 k 个 token 拼进 batch，目标模型<strong>一次前向</strong>并行验证；这是全部收益的来源。</span></li>
  <li><span class="i18n-zh"><strong>「验证要做 k+1 次串行比对」</strong>——不用。一次前向的 k+1 个位置并行产出分布，逐位验证是并行的张量操作（Triton 内核）。</span></li>
  <li><span class="i18n-zh"><strong>「拒绝就是浪费」</strong>——部分对。被拒绝的草稿浪费了草稿前向，但目标模型的验证 KV 与接受前缀完全复用，且拒绝位提供的信息正是自适应深度调整的依据。</span></li>
  <li><span class="i18n-zh"><strong>「输出可能被草稿模型带偏」</strong>——不会。拒绝采样的修正分布保证输出分布与目标模型严格一致；贪心模式等价于逐位比对。</span></li>
</ul>

<h2 id="学习路线">
  <span class="i18n-zh">学习路线</span>
  <span class="i18n-en">Learning path</span>
</h2>

<ol>
  <li><span class="i18n-zh">精读两篇开山论文（Leviathan et al. / Chen et al., ICML'23），自己推一遍修正分布的无偏性。</span></li>
  <li><span class="i18n-zh">手写一个玩具实现：小 GPT-2 草稿 + 大 GPT-2 验证，观察接受率 α 与 γ 的取舍。</span></li>
  <li><span class="i18n-zh">读 vLLM <code>rejection_sampler.py</code>，对照公式看批量验证怎么用 Triton 实现。</span></li>
  <li><span class="i18n-zh">读 <code>llm_base_proposer.py</code>，跟一遍 hidden states 从目标 forward 到草稿输入的完整流转。</span></li>
  <li><span class="i18n-zh">对照周报与 AV / 批分片等新机制，进阶：改一个草稿深度策略或接一个自定义草稿模型。</span></li>
</ol>

<h2 id="论文与资料">
  <span class="i18n-zh">论文与资料</span>
  <span class="i18n-en">Papers &amp; resources</span>
</h2>

<ul>
  <li>Fast Inference from Transformers via Speculative Decoding（Leviathan et al., ICML 2023）</li>
  <li>Accelerating Large Language Model Decoding with Speculative Sampling（Chen et al., 2023）</li>
  <li>Medusa（多头）、EAGLE / EAGLE-3（特征级自回归）、DeepSeek-V3 MTP 技术报告</li>
  <li><span class="i18n-zh">vLLM 源码目录 <code>vllm/v1/spec_decode/</code>（本页源码定位即基于此）</span></li>
</ul>

<p><em><span class="i18n-zh">更新于 2026-10-28；源码细节以所在版本为准。</span></em></p>
