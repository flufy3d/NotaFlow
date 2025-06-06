<script setup lang="ts">
import { ref } from 'vue'
import PitchDetection from './components/PitchDetection.vue'
import AudioConversion from './components/AudioConversion.vue'
import MicConversion from './components/MicConversion.vue'
import AboutPage from './components/AboutPage.vue'

const activeTab = ref('pitch')
</script>

<template>
  <main>
    <PitchDetection v-if="activeTab === 'pitch'" />
    <AudioConversion v-if="activeTab === 'audio'" />
    <MicConversion v-if="activeTab === 'mic'" />
    <AboutPage v-if="activeTab === 'about'" />
  </main>

  <nav class="tab-bar">
    <button @click="activeTab = 'pitch'" :class="{ active: activeTab === 'pitch' }">音高检测</button>
    <button @click="activeTab = 'mic'" :class="{ active: activeTab === 'mic' }">麦克风转换</button>
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
  padding: 12px 0;
  background: #f8f9fa;
  box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.1);
  z-index: 100;
}

.tab-bar button {
  padding: 10px 20px;
  border: none;
  background: none;
  cursor: pointer;
  border-radius: 20px;
  transition: all 0.3s ease;
  font-size: 14px;
  color: #555;
}

.tab-bar button:hover {
  background: rgba(66, 185, 131, 0.1);
}

.tab-bar button.active {
  color: #fff;
  background: #42b983;
  font-weight: 500;
  box-shadow: 0 2px 8px rgba(66, 185, 131, 0.3);
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
