<script setup lang="ts">
import { ref } from 'vue'
import PitchDetection from './components/PitchDetection.vue'
import AudioConversion from './components/AudioConversion.vue'
import AboutPage from './components/AboutPage.vue'

const activeTab = ref('pitch')
</script>

<template>
  <main>
    <PitchDetection v-if="activeTab === 'pitch'" />
    <AudioConversion v-if="activeTab === 'audio'" />
    <AboutPage v-if="activeTab === 'about'" />
  </main>

  <nav class="tab-bar">
    <button @click="activeTab = 'pitch'" :class="{ active: activeTab === 'pitch' }">音高检测</button>
    <button @click="activeTab = 'audio'" :class="{ active: activeTab === 'audio' }">音频转换</button>
    <button @click="activeTab = 'about'" :class="{ active: activeTab === 'about' }">关于</button>
  </nav>
</template>

<style scoped>
.tab-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-around;
  padding: 10px 0;
  background: #fff;
  box-shadow: 0 -2px 5px rgba(0, 0, 0, 0.1);
}

.tab-bar button {
  padding: 8px 16px;
  border: none;
  background: none;
  cursor: pointer;
}

.tab-bar button.active {
  color: #42b983;
  font-weight: bold;
}

@media (min-width: 1024px) {
  header {
    display: flex;
    place-items: center;
    padding-right: calc(var(--section-gap) / 2);
  }

  .logo {
    margin: 0 2rem 0 0;
  }

  header .wrapper {
    display: flex;
    place-items: flex-start;
    flex-wrap: wrap;
  }
}
</style>
