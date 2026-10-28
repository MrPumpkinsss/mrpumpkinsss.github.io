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
</style>

<p>
  <a href="/notes/"><span class="i18n-zh">← 返回学习目录</span><span class="i18n-en">← Back to Study Catalog</span></a>
</p>

<div class="tldr">
  <strong><span class="i18n-zh">先记住四件事</span><span class="i18n-en">TL;DR</span></strong>
  <ul>
    <li><span class="i18n-zh">核心循环：小模型连猜 k 个 token，大模型<strong>一次前向并行验证</strong>——自回归的 k+1 次串行前向，压缩成「小模型 k 次 + 大模型 1 次」。</span></li>
    <li><span class="i18n-zh"><strong>输出分布不变</strong>：拒绝采样保证每个最终 token 的分布与只跑大模型完全一致——数学上无损。</span></li>
    <li><span class="i18n-zh">工程难点在<strong>状态管理</strong>：目标 KV、草稿 KV、隐藏状态三套状态，都要按「验证接受到哪」精确回退或复用。</span></li>
    <li><span class="i18n-zh">收益是接受率 α 的函数：E[每步产出] = (1−α^(k+1))/(1−α)；α 低或草稿太贵就是负收益 → 这就是自适应深度（AV）要解决的问题。</span></li>
  </ul>
</div>

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
  <li><strong><span class="i18n-zh">草稿阶段</span></strong>：<span class="i18n-zh">草稿模型自回归连猜 3 个 token：「北京」「的」「冬天」，每个带草稿概率 q。草稿每猜一个，就要把自己的 KV 写进<strong>草稿自己的 KV cache</strong>（草稿是完整的小模型时）。</span></li>
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

<svg class="dg" viewBox="0 0 860 240" role="img" aria-label="草稿-验证一次迭代示意图">
  <defs>
    <marker id="sdarr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0L10,5L0,10z" class="arrp"/>
    </marker>
  </defs>
  <text x="30" y="26" font-size="13">草稿（串行 k 次，小模型）</text>
  <rect x="30" y="38" width="120" height="46" rx="8" class="b"/><text x="90" y="58" text-anchor="middle" font-size="12">猜「北京」</text><text x="90" y="76" text-anchor="middle" font-size="11" class="ts">q₁=0.9</text>
  <line x1="150" y1="61" x2="176" y2="61" class="ln" marker-end="url(#sdarr)"/>
  <rect x="178" y="38" width="120" height="46" rx="8" class="b"/><text x="238" y="58" text-anchor="middle" font-size="12">猜「的」</text><text x="238" y="76" text-anchor="middle" font-size="11" class="ts">q₂=0.9</text>
  <line x1="298" y1="61" x2="324" y2="61" class="ln" marker-end="url(#sdarr)"/>
  <rect x="326" y="38" width="120" height="46" rx="8" class="b"/><text x="386" y="58" text-anchor="middle" font-size="12">猜「冬天」</text><text x="386" y="76" text-anchor="middle" font-size="11" class="ts">q₃=0.6</text>
  <line x1="446" y1="61" x2="472" y2="61" class="ln" marker-end="url(#sdarr)"/>
  <rect x="474" y="38" width="150" height="46" rx="8" class="ba"/>
  <text x="549" y="58" text-anchor="middle" font-size="12">目标模型一次前向</text>
  <text x="549" y="76" text-anchor="middle" font-size="11" class="ts">验证 k+1…k 个位置</text>
  <text x="660" y="26" font-size="13">验证结果（token 级）</text>
  <rect x="660" y="38" width="56" height="40" rx="6" class="cellok"/><text x="688" y="63" text-anchor="middle" font-size="13">北京</text>
  <rect x="720" y="38" width="56" height="40" rx="6" class="cellok"/><text x="748" y="63" text-anchor="middle" font-size="13">的</text>
  <rect x="780" y="38" width="56" height="40" rx="6" class="cellno"/><text x="808" y="63" text-anchor="middle" font-size="13">冬✗</text>
  <rect x="660" y="86" width="176" height="40" rx="6" class="bg"/>
  <text x="748" y="111" text-anchor="middle" font-size="12">拒绝位重采 →「春」</text>
  <text x="30" y="130" font-size="13">目标模型验证：</text>
  <rect x="140" y="150" width="100" height="44" rx="8" class="b"/><text x="190" y="168" text-anchor="middle" font-size="12">位置1</text><text x="190" y="186" text-anchor="middle" font-size="11" class="ts">✓ 0.92≥q</text>
  <rect x="250" y="150" width="100" height="44" rx="8" class="b"/><text x="300" y="168" text-anchor="middle" font-size="12">位置2</text><text x="300" y="186" text-anchor="middle" font-size="11" class="ts">✓ 0.78 抽中</text>
  <rect x="360" y="150" width="100" height="44" rx="8" class="br"/><text x="410" y="168" text-anchor="middle" font-size="12">位置3</text><text x="410" y="186" text-anchor="middle" font-size="11" class="ts">✗ 0.083 拒绝</text>
  <rect x="470" y="150" width="120" height="44" rx="8" class="bb"/>
  <text x="530" y="168" text-anchor="middle" font-size="12">norm(p−q)+ 重采</text>
  <text x="530" y="186" text-anchor="middle" font-size="11" class="ts">后段草稿全部丢弃</text>
  <line x1="590" y1="172" x2="616" y2="172" class="ln" marker-end="url(#sdarr)"/>
  <rect x="618" y="150" width="120" height="44" rx="8" class="bg"/>
  <text x="678" y="168" text-anchor="middle" font-size="12">「春」</text>
  <text x="678" y="186" text-anchor="middle" font-size="11" class="ts">本步净产出 +3</text>
  <text x="30" y="226" font-size="12" class="ts">关键：目标模型对整个「前缀+3 草稿」只做一次前向；4 个位置的概率并行产出，验证不花额外的目标前向。</text>
</svg>

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
      <td><span class="i18n-zh">草稿自己的层各自缓存草稿 token 的 KV（草稿是独立小模型 / EAGLE 头有自己的注意力）</span></td>
      <td><span class="i18n-zh">独立小模型草稿：滚动回退到「上轮起草起点」重写；基于目标隐状态的起草（EAGLE/MTP）：同样在草稿 cache 上做截断回写</span></td>
    </tr>
    <tr>
      <td><strong><span class="i18n-zh">隐藏状态</span></strong></td>
      <td><span class="i18n-zh">标准拒绝采样中，大小模型<strong>各算各的 hidden states</strong>，互不传递；验证接受到位置 i，目标模型在位置 i 的 last hidden state 恰好就是「继续生成」所需状态</span></td>
      <td><span class="i18n-zh">基于隐状态的方案（EAGLE / MTP）直接<strong>复用目标模型已算好的 hidden state</strong> 给草稿当输入，不用重算——这是这类方法省草稿前向的关键，也是「aux hidden state 精度」这类工程细节的来源（如 DFlash #63436 用 draft dtype 跑 aux FC）</span></td>
    </tr>
  </tbody>
</table>

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
    <tr><td><strong>EAGLE / EAGLE-3</strong></td><td><span class="i18n-zh">草稿头在<strong>特征级</strong>自回归</span></td><td><span class="i18n-zh">草稿头消费<strong>目标模型的 hidden state</strong>：输入 = 目标 last hidden state（EAGLE-3 还拼接若干<strong>中间层 aux hidden states</strong> 经 FC 投影）+ 下一 token 的 embedding → 预测再下一个 token</span></td></tr>
    <tr><td><strong>MTP（DeepSeek-V3 系）</strong></td><td><span class="i18n-zh">附加的 MTP 模块一次预测多步</span></td><td><span class="i18n-zh">输入 = 目标 hidden state + 下一 token embedding；每个深度一个 MTP 模块，有自己的 embedding / 投影 / 头</span></td></tr>
    <tr><td><strong>Medusa / 多头</strong></td><td><span class="i18n-zh">目标骨干上的多个解码头 + 树注意力</span></td><td><span class="i18n-zh">头直接挂在目标顶层 hidden state 上，无独立草稿模型</span></td></tr>
    <tr><td><strong>LayerSkip / 自投机</strong></td><td><span class="i18n-zh">用目标模型前几层提前退出</span></td><td><span class="i18n-zh">早期层的 hidden states 就是草稿信号，同一套权重</span></td></tr>
  </tbody>
</table>

<svg class="dg" viewBox="0 0 860 250" role="img" aria-label="目标 hidden state 流向草稿模型示意图">
  <defs>
    <marker id="hsarr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0L10,5L0,10z" class="arrp"/>
    </marker>
  </defs>
  <text x="30" y="24" font-size="13">目标模型验证前向（一次算 k 个位置）</text>
  <rect x="30" y="36" width="250" height="70" rx="8" class="b"/>
  <text x="155" y="58" text-anchor="middle" font-size="12">target forward</text>
  <text x="155" y="76" text-anchor="middle" font-size="11" class="ts">输出三样：token ids、</text>
  <text x="155" y="93" text-anchor="middle" font-size="11" class="ts">p 分布、last hidden states</text>
  <line x1="280" y1="71" x2="316" y2="71" class="ln" marker-end="url(#hsarr)"/>
  <rect x="318" y="44" width="200" height="54" rx="8" class="ba"/>
  <text x="418" y="66" text-anchor="middle" font-size="12">提取 hidden states</text>
  <text x="418" y="85" text-anchor="middle" font-size="11" class="ts">末层 / EAGLE-3 中间层 aux</text>
  <line x1="518" y1="71" x2="554" y2="71" class="ln" marker-end="url(#hsarr)"/>
  <rect x="556" y="36" width="286" height="70" rx="8" class="b"/>
  <text x="699" y="58" text-anchor="middle" font-size="12">草稿头下一轮自回归输入：</text>
  <text x="699" y="77" text-anchor="middle" font-size="12">h_target + embed(next_token)</text>
  <text x="699" y="95" text-anchor="middle" font-size="11" class="ts">草稿自己只算「增量」，不重复算前缀</text>
  <text x="30" y="140" font-size="12" class="ts">vLLM 源码对应：ModelRunnerOutput 携带 hidden_states / sample_hidden_states / aux_hidden_states 三类张量，</text>
  <text x="30" y="158" font-size="12" class="ts">proposer（EAGLE/extract_hidden_states）消费它们起草；TP 下还会 gather 各 rank 的 hidden states 后拼接（combine_hidden_states）。</text>
  <text x="30" y="190" font-size="13">标准拒绝采样（独立小模型 / n-gram）：</text>
  <rect x="30" y="200" width="360" height="40" rx="8" class="bb"/>
  <text x="210" y="225" text-anchor="middle" font-size="12">hidden states 各算各的，不传输 —— 只有 token id 与概率分布交换</text>
</svg>

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
    <tr><td><span class="i18n-zh">草稿深度选择</span></td><td><span class="i18n-zh">自适应验证（AV）按上一步接受情况动态定 k′，预算选择已内核化（<code>dynamic/</code>，本周 #63421）</span></td></tr>
    <tr><td><span class="i18n-zh">显存分片</span></td><td><span class="i18n-zh">批分片采样下 draft logits 每 rank 只存自己验证的请求（本周 #63554，<code>shard_owner / shard_row</code>）</span></td></tr>
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
