<template>
  <div class="about-page">
    <h1>关于NotaFlow</h1>
    <p>NotaFlow是一个实时音高检测与乐谱转换Web应用，支持乐器与人声的实时音频转换。</p>
    <h2>功能特性</h2>
    <ul>
      <li>实时麦克风音高检测（适用于乐器调音与人声练习）</li>
      <li>音频文件上传转换为乐谱（支持简谱和五线谱两种格式）</li>
    </ul>
    <h2>技术栈</h2>
    <ul>
      <li>Vue 3 + TypeScript</li>
      <li>aubiojs (实时音频处理)</li>
      <li>museaikit (乐谱生成)</li>
    </ul>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  name: 'AboutPage',
});
</script>

<style scoped>
.about-page {
  padding: 2rem;
  max-width: 800px;
  margin: 0 auto;
  color: #333;
}

.about-page h1 {
  font-size: 2rem;
  color: #2c3e50;
  margin-bottom: 1.5rem;
  border-bottom: 2px solid #42b983;
  padding-bottom: 0.5rem;
}

.about-page h2 {
  font-size: 1.5rem;
  color: #2c3e50;
  margin: 1.5rem 0 1rem;
}

.about-page p {
  line-height: 1.6;
  margin-bottom: 1.5rem;
}

.about-page ul {
  padding-left: 1.5rem;
  line-height: 1.6;
}

.about-page li {
  margin-bottom: 0.5rem;
}
</style>