---
layout: archive
permalink: /
title: "About Me"
author_profile: true
redirect_from: 
  - /about/
  - /about.html
---

<style>
/* 个人主页内容区块样式，效果与 Blog/Projects 页面相同 */
.about-section {
  background: #fff;
  padding: 20px;
  margin: 20px auto;     /* auto 会使信息框水平居中 */
  max-width: 800px;
  border: 1px solid #ddd;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  transition: transform 0.3s ease, box-shadow 0.3s ease;
}

/* 悬浮效果 */
.about-section:hover {
  transform: translateY(-5px);
  box-shadow: 0 6px 12px rgba(0,0,0,0.15);
}

/* 标题样式：去除首行缩进和内边距 */
.about-section h2 {
  font-size: 1.75rem;
  margin: 0 0 15px;
  text-align: center;
  font-weight: bold;
  color: #333;
  text-indent: 0;
  padding-left: 0;
}

.about-section h3 {
  margin: 12px 0 6px;
}

/* 研究方向卡片 */
.interest-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 10px;
}
.interest-card {
  flex: 1 1 220px;
  border: 1px solid #e3e3e3;
  border-radius: 8px;
  padding: 12px 14px;
  background: #fafafa;
}
.interest-card strong {
  display: block;
  margin-bottom: 4px;
  color: #007acc;
}

/* 移动端适配 */
@media (max-width: 600px) {
  .about-section {
    padding: 15px;
  }
  
  .about-section h2 {
    font-size: 1.5rem;
  }
}
</style>

<p>
  <span class="i18n-zh">欢迎来到我的个人主页！我是 <strong>Ma Jiawei</strong>，出生于 2004 年 8 月 12 日，目前是香港理工大学的博士一年级研究生。你可以在下方的信息或顶部导航栏中了解更多关于我的内容。</span>
  <span class="i18n-en">Welcome to my homepage! My name is <strong>Ma Jiawei</strong>. My birthday is August 12, 2004. I am currently a first-year PhD student at <a href="https://www.polyu.edu.hk/en/">The Hong Kong Polytechnic University</a>. You can learn more about me in the information below or in the navigation bar above.</span>
</p>

<div class="about-section">
  <h2><span class="i18n-zh">我的简介</span><span class="i18n-en">My Profile</span></h2>
  <ul>
    <li>🎓 <span class="i18n-zh">香港理工大学博士研究生（一年级，2026 级）</span><span class="i18n-en">First-year PhD student (2026 cohort) at The Hong Kong Polytechnic University</span></li>
    <li>🏅 <span class="i18n-zh">本科以<strong>一等荣誉</strong>毕业于电机工程学系（副修人工智能及数据分析）</span><span class="i18n-en">Graduated with <strong>First Class Honours</strong> in Electrical Engineering (with a Secondary Major in AI &amp; Data Analytics)</span></li>
    <li>🔬 <span class="i18n-zh">研究方向：边缘大模型 · 投机解码 · 大模型推理加速</span><span class="i18n-en">Research interests: Edge LLMs · Speculative Decoding · LLM Inference Acceleration</span></li>
  </ul>
</div>

<div class="about-section">
  <h2><span class="i18n-zh">研究方向</span><span class="i18n-en">Research Interests</span></h2>
  <div class="interest-grid">
    <div class="interest-card">
      <strong><span class="i18n-zh">边缘大模型</span><span class="i18n-en">Edge LLMs</span></strong>
      <span class="i18n-zh">让大语言模型在资源受限的边缘设备（NPU、PC、手机等）上高效运行：端云协同、异构算力利用与系统协同设计。</span>
      <span class="i18n-en">Serving large language models efficiently on resource-constrained edge devices (NPUs, PCs, phones): device-cloud collaboration, heterogeneous compute, and system co-design.</span>
    </div>
    <div class="interest-card">
      <strong><span class="i18n-zh">投机解码</span><span class="i18n-en">Speculative Decoding</span></strong>
      <span class="i18n-zh">草稿-验证范式：在不改变输出分布的前提下加速自回归解码，包括草稿模型设计、验证策略与接受率-时延权衡。</span>
      <span class="i18n-en">Draft-and-verify paradigms that accelerate autoregressive decoding without changing the output distribution: drafter design, verification strategies, and acceptance-rate vs. latency trade-offs.</span>
    </div>
    <div class="interest-card">
      <strong><span class="i18n-zh">大模型推理加速</span><span class="i18n-en">LLM Inference Acceleration</span></strong>
      <span class="i18n-zh">面向服务场景的系统优化：KV cache 管理、连续批处理、前缀复用、量化与调度策略。</span>
      <span class="i18n-en">Systems optimizations for serving: KV cache management, continuous batching, prefix reuse, quantization, and scheduling.</span>
    </div>
  </div>
</div>

<div class="about-section">
  <h2><span class="i18n-zh">教育经历</span><span class="i18n-en">Education</span></h2>
  <h3><span class="i18n-zh">香港理工大学 — 博士（在读）</span><span class="i18n-en">The Hong Kong Polytechnic University — Ph.D. (in progress)</span></h3>
  <p>
    <span class="i18n-zh">2026.09 – 至今 · 研究方向：边缘大模型、投机解码与大模型推理加速</span>
    <span class="i18n-en">Sep. 2026 – Present · Research: Edge LLMs, Speculative Decoding, and LLM Inference Acceleration</span>
  </p>
  <h3><span class="i18n-zh">香港理工大学 — 电机工程学学士（一等荣誉）</span><span class="i18n-en">The Hong Kong Polytechnic University — BEng (Hons), First Class Honours</span></h3>
  <p>
    <span class="i18n-zh">电机工程学（荣誉）工学士，副修人工智能及数据分析</span>
    <span class="i18n-en">BEng (HONS) Electrical Engineering with a Secondary Major in AI &amp; Data Analytics</span><br>
    <em>2022.09 – 2026.06</em> | <em><span class="i18n-zh">一等荣誉毕业 · CGPA 3.88/4.3</span><span class="i18n-en">First Class Honours · CGPA 3.88/4.3</span></em>
  </p>
</div>

<div class="about-section">
  <h2><span class="i18n-zh">项目</span><span class="i18n-en">Projects</span></h2>
  <p>
    <span class="i18n-zh">❗️这一部分的更多信息，建议直接访问上方导航栏的「项目」页面。</span>
    <span class="i18n-en">❗️For more information about this part, I suggest you go to the <a href="/projects/">Projects</a> section in the navigation bar above.</span>
  </p>
  
  <h3><span class="i18n-zh">AI 电磁炮</span><span class="i18n-en">AI-Powered Electromagnetic Cannon</span></h3>
  <p>
    <span class="i18n-zh">一门能够自动瞄准并高速发射磁体的电磁炮。</span>
    <span class="i18n-en">An electromagnetic cannon that can aim itself and shoot magnets at high speeds.</span>
  </p>
  <p><a href="/projects/2024%20Electromagnetic%20Auto-Aiming%20Toy%20Shooter/"><span class="i18n-zh">点击查看详情</span><span class="i18n-en">Click Me For More Information</span></a></p>
  
  <h3><span class="i18n-zh">AI 智能自动瞄准遥控炮塔车</span><span class="i18n-en">AI-Powered Smart Auto-Aiming RC Toy Car with Turret</span></h3>
  <p>
    <span class="i18n-zh">具备第一人称视角与手机实时控制的智能软弹发射遥控车。</span>
    <span class="i18n-en">An intelligent foam projectile launcher toy car with First-Person View capability and real-time smartphone control.</span>
  </p>
  <p><a href="/projects/2025%20AI-Powered%20Smart%20Auto-Aiming%20RC%20Toy%20Car%20with%20Turret/"><span class="i18n-zh">点击查看详情</span><span class="i18n-en">Click Me For More Information</span></a></p>
  
  <!-- 导航箭头区域：文本及箭头按钮 -->
  <div style="text-align: center; margin-top: 20px;">
    <a href="/projects/" style="text-decoration: none; font-size: 1.2rem;">
      <span class="i18n-zh">点击了解更多 →</span><span class="i18n-en">Click here to learn more →</span>
    </a>
  </div>
</div>

<div class="about-section">
  <h2><span class="i18n-zh">荣誉奖项</span><span class="i18n-en">Awards &amp; Honors</span></h2>
  <ul>
    <li><span class="i18n-zh">🥇 <strong>冠军及设计奖</strong></span><span class="i18n-en">🥇 <strong>Champion &amp; Design Award</strong></span> — EIE Microcontroller Application Design Contest (2023-24)</li>
    <li><span class="i18n-zh">🥇 <strong>冠军</strong></span><span class="i18n-en">🥇 <strong>Champion</strong></span> — Innovative AI Applications Competition (2024-25)</li>
    <li><span class="i18n-zh">🥉 <strong>季军</strong></span><span class="i18n-en">🥉 <strong>Third Prize</strong></span> — 10th HK University Student Innovation Competition</li>
    <li><span class="i18n-zh">📜 <strong>院长嘉许名单</strong></span><span class="i18n-en">📜 <strong>Dean's Honours List</strong></span> — PolyU Faculty of Engineering (2023)</li>
    <li><span class="i18n-zh">🏅 <strong>全球排名金奖</strong></span><span class="i18n-en">🏅 <strong>Gold (Global Ranking)</strong></span> - British Physics Olympiad (BPhO) 2020-2021 Intermediate Physics Challenge</li>
    <li><span class="i18n-zh">📜 <strong>荣誉证书（前 25%）</strong></span><span class="i18n-en">📜 <strong>Honor Roll Certificate (Top 25%)</strong></span> - 2020-2021 Mathematics Leagues Contest in China</li>
    <li><span class="i18n-zh">📜 <strong>荣誉证书（前 25%）</strong></span><span class="i18n-en">📜 <strong>Honor Roll Certificate (Top 25%)</strong></span> - 2019-2020 Mathematics Leagues Contest in China</li>
    <li><span class="i18n-zh">🥉 <strong>全国排名铜奖</strong></span><span class="i18n-en">🥉 <strong>Bronze (National Ranking)</strong></span> - 2019 Canadian Open Mathematics Challenge (COMC)</li>
  </ul>
</div>

<div class="about-section">
  <h2><span class="i18n-zh">技术栈</span><span class="i18n-en">Technical Toolkit</span></h2>
  <p>
    <span class="i18n-zh"><strong>编程语言：</strong></span><span class="i18n-en"><strong>Programming Languages:</strong></span><br>
    <code>Python</code> &nbsp; <code>C/C++</code> &nbsp; <code>MATLAB</code>
  </p>
  <p>
    <span class="i18n-zh"><strong>框架与平台：</strong></span><span class="i18n-en"><strong>Frameworks &amp; Platforms:</strong></span><br>
    <code>PyTorch</code> &nbsp; <code>vLLM</code> &nbsp; <code>SGLang</code> &nbsp; <code>OpenCV</code> &nbsp; <code>TensorFlow</code> &nbsp; <code>Raspberry Pi</code> &nbsp; <code>Arduino</code>
  </p>
  <p>
    <span class="i18n-zh"><strong>语言能力：</strong></span><span class="i18n-en"><strong>Spoken Languages:</strong></span><br>
    🇨🇳 <span class="i18n-zh">中文（母语）</span><span class="i18n-en">Mandarin (Native)</span> &nbsp; 🇬🇧 <span class="i18n-zh">英语（流利）</span><span class="i18n-en">English (Fluent)</span>
  </p>
</div>
