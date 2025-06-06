<template>
  <div class="mic-conversion">
    <h1>音频转乐谱工具</h1>
    <p>将您的录音直接转换为可播放和下载的乐谱。</p>

    <h2>1. 录制音频</h2>
    <p>点击“开始录音”，演奏一段旋律，然后点击“停止录音”以生成乐谱。</p>
    <section>
      <button @click="toggleRecording" :disabled="isProcessing">
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
          <button id="play-score-btn">播放乐谱</button>
          <button @click="downloadMidi">下载 MIDI</button>
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
import { ref, watch } from 'vue';
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
  { value: 0, label: 'C大调' }, { value: 1, label: '#C大调/降D大调' },
  { value: 2, label: 'D大调' }, { value: 3, label: '#D大调/降E大调' },
  { value: 4, label: 'E大调' }, { value: 5, label: 'F大调' },
  { value: 6, label: '#F大调/降G大调' }, { value: 7, label: 'G大调' },
  { value: 8, label: '#G大调/降A大调' }, { value: 9, label: 'A大调' },
  { value: 10, label: '#A大调/降B大调' }, { value: 11, label: 'B大调' }
];

mm.logging.setVerbosity(mm.logging.Level.WARN);

// Watch for key signature changes to re-render the score
watch(selectedKeySignature, (newVal) => {
  if (finalCleanedNs.value) {
    // Create a clone to modify without affecting the original cleaned sequence
    const nsToRender = mm.sequences.clone(finalCleanedNs.value);
    renderScore(nsToRender);
  }
});

// --- Core Logic ---

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
      
      recorder.start();
      isRecording.value = true;
      finalCleanedNs.value = null; // Clear previous score
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
    
    // 1. Transcribe
    const rawNs = await oafA.transcribeFromAudioFile(blob);
    
    // 2. Clean with default parameters
    const cleanedNs = mm.cleanNoteSequence(rawNs, 0.1, 0.08, 0.5);
    finalCleanedNs.value = cleanedNs; // Store for download and re-render
    
    // 3. Render the final score
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

  // Set key signature based on dropdown
  ns.keySignatures = [{ key: selectedKeySignature.value, time: 0 }];

  const staff = document.getElementById('staff') as HTMLDivElement;
  const jianpu = document.getElementById('jianpu') as HTMLDivElement;
  if (!staff || !jianpu) return;

  staff.innerHTML = '';
  jianpu.innerHTML = '';

  let staffViz = new mm.StaffSVGVisualizer(ns, staff);
  let jianpuViz = new mm.JianpuSVGVisualizer(ns, jianpu);

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
    // Replace the button to remove old event listeners
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

button[v-on\:click="toggleRecording"] {
  background-color: #007bff;
}
button[v-on\:click="toggleRecording"]:hover {
  background-color: #0056b3;
}
.is-recording { /* A class to indicate recording state if needed */
  background-color: #dc3545 !important;
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

#play-score-btn, button[v-on\:click="downloadMidi"] {
  background-color: #28a745;
}
#play-score-btn:hover, button[v-on\:click="downloadMidi"]:hover {
  background-color: #1e7e34;
}

.loading-indicator {
  margin-top: 15px;
  color: #555;
  font-weight: bold;
}

.visualizer-container {
  height: 120px;
  width: 100%;
  overflow-x: auto;
  border: 1px solid #ccc;
  background-color: white;
  border-radius: 5px;
}

.visualizer-container svg {
  height: 100%;
}
</style>