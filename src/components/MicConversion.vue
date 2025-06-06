<template>
  <div class="mic-conversion">
    <h1>音频转乐谱工具</h1>
    <p>将您的录音直接转换为可播放和下载的乐谱。</p>

    <h2>1. 录制音频</h2>
    <p>点击“开始录音”，演奏一段旋律，然后点击“停止录音”以生成乐谱。</p>
    <section>
      <!-- 录音按钮：添加了动态 class 用于样式切换 -->
      <button 
        @click="toggleRecording" 
        :disabled="isProcessing"
        class="record-btn"
        :class="{ 'is-recording': isRecording }"
      >
        {{ isRecording ? '停止录音' : '开始录音' }}
      </button>
      <div v-show="isProcessing" class="loading-indicator">
        <p><b>正在处理音频，请稍候...</b></p>
      </div>
    </section>

    <h2>2. 最终乐谱</h2>
    <section>
      <div v-if="finalCleanedNs">
        <div class="controls-container">
          <div class="key-signature-control">
            <label for="key-signature-select">调式选择: </label>
            <select id="key-signature-select" v-model="selectedKeySignature">
              <option v-for="(key, index) in keySignatureOptions" :key="index" :value="key.value">
                {{ key.label }}
              </option>
            </select>
          </div>
          <!-- 播放和下载按钮 -->
          <button id="play-score-btn" class="action-btn">播放乐谱</button>
          <button @click="downloadMidi" class="action-btn">下载 MIDI</button>
        </div>
        <br> 
        <div class="visualizer-container">
          <div id="staff"></div>
        </div>
        <br>
        <div class="visualizer-container">
          <div id="jianpu"></div>
        </div>
      </div>
      <div v-else>
        <p>录音并处理后，乐谱将显示在此处。</p>
      </div>
    </section>

    <h2>结束</h2>
    <section>
      <p>
      感谢您使用我们的工具。如果您有任何问题或反馈，请随时联系。
      </p>
    </section>

  </div>
</template>

<script lang="ts" setup>
// 导入了 nextTick，用于解决DOM更新时序问题
import { ref, watch, nextTick } from 'vue';
import * as mm from 'museaikit';
import { saveAs } from 'file-saver';

// Constants
const CHECKPOINTS_DIR = 'https://storage.googleapis.com/magentadata/js/checkpoints';
const SOUNDFONT_URL = 'https://storage.googleapis.com/magentadata/js/soundfonts/sgm_plus';
const CKPT_URL = `${CHECKPOINTS_DIR}/transcription/onsets_frames_uni`;

// Reactive state
const finalCleanedNs = ref<mm.INoteSequence | null>(null);
const isProcessing = ref(false);
const isRecording = ref(false);
const mediaRecorder = ref<MediaRecorder | null>(null);

const selectedKeySignature = ref(0);
const keySignatureOptions = [
  { value: 0, label: 'C大调' }, { value: 1, label: 'C♯/D♭大调' },
  { value: 2, label: 'D大调' }, { value: 3, label: 'D♯/E♭大调' },
  { value: 4, label: 'E大调' }, { value: 5, label: 'F大调' },
  { value: 6, label: 'F♯/G♭大调' }, { value: 7, label: 'G大调' },
  { value: 8, label: 'G♯/A♭大调' }, { value: 9, label: 'A大调' },
  { value: 10, label: 'A♯/B♭大调' }, { value: 11, label: 'B大调' }
];

mm.logging.setVerbosity(mm.logging.Level.WARN);

// 监视调式变化，重新渲染乐谱
watch(selectedKeySignature, () => {
  if (finalCleanedNs.value) {
    const nsToRender = mm.sequences.clone(finalCleanedNs.value);
    renderScore(nsToRender);
  }
});

// --- 核心逻辑 ---

async function toggleRecording() {
  if (isRecording.value) {
    mediaRecorder.value?.stop();
    isRecording.value = false;
  } else {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorder.value = recorder;
      
      const recordedChunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunks.push(event.data);
      };

      recorder.onstop = () => {
        const recordedBlob = new Blob(recordedChunks, { type: 'audio/webm' });
        processAudioBlob(recordedBlob);
        stream.getTracks().forEach(track => track.stop());
      };
      
      // *** 核心修改 1: 开始新录音时，重置状态 ***
      finalCleanedNs.value = null;     // 清空旧乐谱
      selectedKeySignature.value = 0;  // 默认设置为 C 大调
      
      recorder.start();
      isRecording.value = true;
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("无法访问麦克风。请检查浏览器权限并确保在HTTPS环境下运行。");
      isRecording.value = false;
    }
  }
}

async function processAudioBlob(blob: Blob) {
  isProcessing.value = true;
  let oafA: mm.OnsetsAndFrames | null = null;
  
  try {
    oafA = new mm.OnsetsAndFrames(CKPT_URL);
    await oafA.initialize();
    
    // 1. 转录
    const rawNs = await oafA.transcribeFromAudioFile(blob);
    
    // 2. 清理音符序列
    const cleanedNs = mm.cleanNoteSequence(rawNs, 0.1, 0.08, 0.5);
    finalCleanedNs.value = cleanedNs;
    
    // *** 核心修改 2: 等待DOM更新后再渲染 ***
    // Vue 更新DOM是异步的。设置 finalCleanedNs 后，v-if 会让乐谱容器显示出来。
    // 我们需要用 nextTick 等待这个过程完成，确保 #staff 和 #jianpu 元素存在。
    await nextTick();
    
    // 3. 渲染最终乐谱
    renderScore(cleanedNs);

  } catch (error) {
    console.error("Error during transcription/processing:", error);
    alert("处理音频时出错，请查看控制台获取详情。");
    finalCleanedNs.value = null;
  } finally {
    oafA?.dispose();
    isProcessing.value = false;
  }
}

function renderScore(ns: mm.INoteSequence) {
  if (!ns) return;

  // 根据下拉菜单设置调式
  ns.keySignatures = [{ key: selectedKeySignature.value, time: 0 }];

  const staffDiv = document.getElementById('staff') as HTMLDivElement;
  const jianpuDiv = document.getElementById('jianpu') as HTMLDivElement;
  if (!staffDiv || !jianpuDiv) return;

  staffDiv.innerHTML = '';
  jianpuDiv.innerHTML = '';

  let staffViz = new mm.StaffSVGVisualizer(ns, staffDiv);
  let jianpuViz = new mm.JianpuSVGVisualizer(ns, jianpuDiv);

  const player = new mm.SoundFontPlayer(
    SOUNDFONT_URL, undefined, undefined, undefined, {
    run: (note: mm.NoteSequence.Note) => {
      staffViz.redraw(note);
      jianpuViz.redraw(note);
    },
    stop: () => {
      staffViz.clearActiveNotes();
      jianpuViz.clearActiveNotes();
    }
  });

  const playButtonClickHandler = () => {
    const btn = document.getElementById('play-score-btn');
    if (!btn) return;
    if (player.isPlaying()) {
      player.stop();
      btn.textContent = '播放乐谱';
    } else {
      player.start(ns).then(() => { btn.textContent = '播放乐谱'; });
      btn.textContent = '停止';
    }
  };

  const playButton = document.getElementById('play-score-btn');
  if (playButton) {
    const newPlayButton = playButton.cloneNode(true);
    playButton.parentNode?.replaceChild(newPlayButton, playButton);
    newPlayButton.addEventListener('click', playButtonClickHandler);
  }
}

function downloadMidi() {
  if (finalCleanedNs.value) {
    const midi = mm.sequenceProtoToMidi(finalCleanedNs.value);
    const file = new File([midi], 'transcription.mid', { type: 'audio/midi' });
    saveAs(file);
  } else {
    alert('没有可供下载的乐谱。');
  }
}
</script>

<style scoped>
.mic-conversion {
  padding: 20px;
  font-family: sans-serif;
  max-width: 800px;
  margin: auto;
}

.mic-conversion h1, .mic-conversion h2 {
  color: #333;
  border-bottom: 1px solid #eee;
  padding-bottom: 10px;
}

.mic-conversion section {
  margin-bottom: 25px;
  padding: 20px;
  border: 1px solid #ddd;
  border-radius: 8px;
  background-color: #f9f9f9;
}

.mic-conversion button {
  padding: 10px 15px;
  margin-right: 10px;
  color: white;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  font-size: 16px;
  transition: background-color 0.2s;
}

.mic-conversion button:disabled {
  background-color: #ccc;
  cursor: not-allowed;
}

/* *** 核心修改 3: 优化按钮样式 *** */
/* 录音按钮默认状态 (蓝色) */
.record-btn {
  background-color: #007bff;
}
.record-btn:hover:not(:disabled) {
  background-color: #0056b3;
}

/* 录音按钮在录音中状态 (红色) */
.record-btn.is-recording {
  background-color: #dc3545;
}
.record-btn.is-recording:hover:not(:disabled) {
  background-color: #c82333;
}

/* 其他操作按钮 (绿色) */
.action-btn {
  background-color: #28a745;
}
.action-btn:hover:not(:disabled) {
  background-color: #1e7e34;
}

.controls-container {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 15px;
}

.key-signature-control select {
  padding: 8px;
  border-radius: 5px;
  border: 1px solid #ccc;
  font-size: 14px;
}

.loading-indicator {
  margin-top: 15px;
  color: #555;
}

.visualizer-container {
  height: 120px;
  width: 100%;
  overflow-x: auto;
  border: 1px solid #ccc;
  background-color: white;
  border-radius: 5px;
}

/* 确保SVG填满容器高度 */
.visualizer-container > div > svg {
  height: 100%;
}
</style>