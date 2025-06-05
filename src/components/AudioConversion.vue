<template>
  <div class="audio-conversion">
    <h1>音频转乐谱工具</h1>
    <p>将音频文件或录音转换为乐谱，还能通过合并碎片化音符和过滤短音符来优化转录结果。</p>

    <h2>Process Audio File</h2>
    <p>You can use your own audio file for transcription:</p>
    <section>
      <label class="button">
        Load audio file
        <input type="file" @change="handleFileUpload" accept="audio/*">
      </label>
      <br>
      <p><audio ref="filePlayerEl" controls hidden></audio></p>
      <div v-show="isLoadingFile">
        <p><b>Actual Transcription:</b> <code class="file">Loading...</code></p>
        <p><b>It Took:</b> <code class="file">Loading...</code></p>
      </div>
      <div v-show="!isLoadingFile">
        <p><b>Actual Transcription:</b></p>
        <div ref="fileResultsContainer" class="file-results-container"></div>
        <p><b>It Took:</b> <code class="file">{{ fileTimeText }}</code></p>
      </div>
    </section>

    <h2>Optimize Midi File</h2>
    <p>Click the button to start MIDI optimization and cleaning process:</p>
    <section>
      <div>
        <label for="minDurationSlider">Min Note Duration (s): <span>{{ minDuration.toFixed(2) }}</span></label>
        <input type="range" id="minDurationSlider" min="0.01" max="0.5" step="0.01" v-model.number="minDuration">
      </div>
      <div>
        <label for="mergeThresholdSlider">Merge Threshold (s): <span>{{ mergeThreshold.toFixed(2) }}</span></label>
        <input type="range" id="mergeThresholdSlider" min="0.01" max="0.2" step="0.01" v-model.number="mergeThreshold">
      </div>
      <div>
        <label for="quantizeResolutionSlider">Quantize Resolution (s): <span>{{ quantizeResolution.toFixed(2) }}</span></label>
        <input type="range" id="quantizeResolutionSlider" min="0.01" max="1.0" step="0.01" v-model.number="quantizeResolution">
      </div>
      <br>
      <button @click="optimizeMidi" :disabled="!originalNs || isLoadingOptimize">Optimize MIDI</button>
      <button @click="resetParameters">Reset Parameters</button>
      <br>
      <div v-show="isLoadingOptimize">
        <p><audio ref="optimizePlayerEl" controls hidden></audio></p>
        <p><b>Actual Transcription:</b> <code class="optimize">Loading...</code></p>
        <p><b>It Took:</b> <code class="optimize">Loading...</code></p>
      </div>
      <div v-show="!isLoadingOptimize">
        <p><audio ref="optimizePlayerEl" controls hidden></audio></p>
        <p><b>Actual Transcription:</b></p>
        <div ref="optimizeResultsContainer" class="optimize-results-container"></div>
        <p><b>It Took:</b> <code class="optimize">{{ optimizeTimeText }}</code></p>
      </div>
    </section>

    <h2>最终乐谱</h2>
    <section>
      <button id="play-score-btn">播放乐谱</button>
      <br> 
      <br>
      <div class="visualizer-container">
        <div id="staff"></div>
      </div>
      <br>
      <div class="visualizer-container">
        <div id="jianpu"></div>
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
import { ref, onMounted } from 'vue';
import * as mm from 'museaikit';
import { saveAs } from 'file-saver';



// Constants from common.ts
const CHECKPOINTS_DIR = 'https://storage.googleapis.com/magentadata/js/checkpoints';
const SOUNDFONT_URL = 'https://storage.googleapis.com/magentadata/js/soundfonts/sgm_plus';
const CKPT_URL = `${CHECKPOINTS_DIR}/transcription/onsets_frames_uni`;

// Reactive state
const originalNs = ref<mm.INoteSequence | null>(null);
const filePlayerEl = ref<HTMLAudioElement | null>(null);
const optimizePlayerEl = ref<HTMLAudioElement | null>(null); // Although not directly used in optimizeMidi, kept for symmetry if needed
const fileResultsContainer = ref<HTMLElement | null>(null);
const optimizeResultsContainer = ref<HTMLElement | null>(null);

const fileTimeText = ref('');
const optimizeTimeText = ref('');

const isLoadingFile = ref(false);
const isLoadingOptimize = ref(false);

// Slider values
const minDuration = ref(0.1);
const mergeThreshold = ref(0.08);
const quantizeResolution = ref(0.5);

mm.logging.setVerbosity(mm.logging.Level.DEBUG); // Or use mm.logging.Level.WARN for less noise


// --- Helper functions adapted from common.ts ---

function writeTimer(timeRef: typeof fileTimeText | typeof optimizeTimeText, startTime: number) {
  timeRef.value = ((performance.now() - startTime) / 1000).toFixed(3) + 's';
}

function createPlayerButton(
  seq: mm.INoteSequence,
  withClick: boolean,
  useSoundFontPlayer: boolean,
  svgEl: SVGSVGElement,
  playerContainerDiv: HTMLDivElement // Pass the container for scrolling
): HTMLButtonElement {
  const visualizer = new mm.PianoRollSVGVisualizer(seq, svgEl);

  const callbackObject: mm.PlayerCallback = {
    run: (note: mm.NoteSequence.Note) => {
      const currentNotePosition = visualizer.redraw(note);
      const containerWidth = playerContainerDiv.getBoundingClientRect().width;
      if (currentNotePosition > (playerContainerDiv.scrollLeft + containerWidth)) {
        playerContainerDiv.scrollLeft = currentNotePosition - 20;
      }
    },
    stop: () => {}
  };

  const button = document.createElement('button');
  const playText = withClick ? 'Play With Click' : 'Play';
  button.textContent = playText;
  button.disabled = true; // Disable until player is ready

  let player: mm.Player | mm.SoundFontPlayer;
  if (useSoundFontPlayer) {
    player = new mm.SoundFontPlayer(
      SOUNDFONT_URL,
      undefined,
      undefined,
      undefined,
      callbackObject
    );
    (player as mm.SoundFontPlayer).loadSamples(seq).then(() => {
      button.disabled = false;
    }).catch(err => {
        console.error("Error loading soundfont samples:", err);
        button.textContent = "SF Load Error";
    });
  } else {
    player = new mm.Player(withClick, callbackObject);
    button.disabled = false;
  }

  button.addEventListener('click', () => {
    if (player.isPlaying()) {
      player.stop();
      button.textContent = playText;
    } else {
      player.start(visualizer.noteSequence as mm.INoteSequence)
        .then(() => (button.textContent = playText))
        .catch(err => {
            console.error("Error playing sequence:", err);
            button.textContent = "Play Error";
        });
      button.textContent = 'Stop';
    }
  });
  return button;
}

function createDownloadButton(seq: mm.INoteSequence): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = 'Save MIDI';
  button.addEventListener('click', () => {
    saveAs(new File([mm.sequenceProtoToMidi(seq)], 'saved.mid'));
  });
  return button;
}

function createPlayer(seq: mm.INoteSequence, useSoundFontPlayer = false): HTMLDivElement {
  const div = document.createElement('div');
  div.classList.add('player-container');

  const containerDiv = document.createElement('div');
  containerDiv.classList.add('visualizer-container');
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  containerDiv.appendChild(el);

  const buttonsDiv = document.createElement('div');
  buttonsDiv.appendChild(
    createPlayerButton(seq, false, useSoundFontPlayer, el, containerDiv)
  );

  if (!useSoundFontPlayer && mm.sequences.isQuantizedSequence(seq)) {
    buttonsDiv.appendChild(createPlayerButton(seq, true, false, el, containerDiv));
  }

  buttonsDiv.appendChild(createDownloadButton(seq));
  div.appendChild(buttonsDiv);
  div.appendChild(containerDiv);
  return div;
}

function writeNoteSeqs(
  containerRef: typeof fileResultsContainer | typeof optimizeResultsContainer,
  seqs: mm.INoteSequence[],
  useSoundFontPlayer = false,
  writeVelocity = false // This param was in original, but not used for visualization here
) {
  const element = containerRef.value;
  if (!element) {
    console.error('Container element not found');
    return;
  }

  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }


  seqs.forEach(seq => {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'View NoteSequence';
    details.appendChild(summary);

    details.appendChild(createPlayer(seq, useSoundFontPlayer));
    element.appendChild(details);
  });
}


// --- Component Logic ---

const handleFileUpload = (event: Event) => {
  const target = event.target as HTMLInputElement;
  if (target.files && target.files.length > 0) {
    const file = target.files[0];
    transcribeFromFile(file);
  }
};

async function transcribeFromFile(blob: Blob) {
  if (!filePlayerEl.value || !fileResultsContainer.value) return;

  isLoadingFile.value = true;
  fileTimeText.value = '';
  if (fileResultsContainer.value) fileResultsContainer.value.innerHTML = ''; // Clear previous results

  filePlayerEl.value.hidden = false;
  filePlayerEl.value.src = URL.createObjectURL(blob);

  let oafA: mm.OnsetsAndFrames | null = null;
  try {
    oafA = new mm.OnsetsAndFrames(CKPT_URL);
    await oafA.initialize();
    const start = performance.now();
    const ns = await oafA.transcribeFromAudioFile(blob);
    originalNs.value = mm.sequences.clone(ns); // Clone to be safe
    
    writeTimer(fileTimeText, start);
    writeNoteSeqs(fileResultsContainer, [ns], true, true);

  } catch (error) {
    console.error("Error during transcription:", error);
    if (fileResultsContainer.value) {
        fileResultsContainer.value.textContent = "Error during transcription. See console for details.";
    }
    originalNs.value = null; // Ensure optimize button remains disabled
  } finally {
    if (oafA) {
      oafA.dispose();
    }
    isLoadingFile.value = false;
  }
}

const resetParameters = () => {
  minDuration.value = 0.1;
  mergeThreshold.value = 0.08;
  quantizeResolution.value = 0.5;
};



const optimizeMidi = () => {
  if (!originalNs.value || !optimizeResultsContainer.value) return;

  isLoadingOptimize.value = true;
  optimizeTimeText.value = '';
  if (optimizeResultsContainer.value) optimizeResultsContainer.value.innerHTML = '';

  const start = performance.now();
  const cleanedNs = mm.cleanNoteSequence(
    originalNs.value,
    minDuration.value,
    mergeThreshold.value,
    quantizeResolution.value
  );

  writeTimer(optimizeTimeText, start);
  writeNoteSeqs(optimizeResultsContainer, [cleanedNs], true, true);

  //staff
  const staff = document.getElementById('staff') as HTMLDivElement;
  let staffSVGVisualizer = new mm.StaffSVGVisualizer(cleanedNs, staff);

  //jianpu
  const jianpu = document.getElementById('jianpu') as HTMLDivElement;
  let jianpuSVGVisualizer = new mm.JianpuSVGVisualizer(cleanedNs, jianpu);

  // 创建播放器
  const player = new mm.SoundFontPlayer(
    SOUNDFONT_URL,
    mm.Player.tone.Master, undefined, undefined, {
    run: (note: mm.NoteSequence.Note) => {
      jianpuSVGVisualizer.redraw(note);
      staffSVGVisualizer.redraw(note);
    },
    stop: () => {
      jianpuSVGVisualizer.clearActiveNotes();
      staffSVGVisualizer.clearActiveNotes();
    }
  });

  // 创建播放控制按钮
  const playButton = document.getElementById('play-score-btn');
  playButton.textContent = '播放乐谱';

  
  // 添加播放/停止控制
  playButton.addEventListener('click', () => {
    if (player.isPlaying()) {
      player.stop();
      playButton.textContent = '播放乐谱';
    } else {
      playButton.textContent = '停止';
      player.start(cleanedNs)
        .then(() => {
          playButton.textContent = '播放乐谱';
        })
        .catch(err => {
          console.error("播放错误:", err);
          playButton.textContent = "播放错误";
        });
    }
  });



  isLoadingOptimize.value = false;
};

onMounted(() => {
  // You could pre-load the model here if desired, but the original demo
  // loads it on file selection.
});

</script>

<style scoped>
.audio-conversion {
  padding: 20px;
  font-family: sans-serif;
}

.audio-conversion h1, .audio-conversion h2 {
  color: #333;
}

.audio-conversion section {
  margin-bottom: 20px;
  padding: 15px;
  border: 1px solid #ddd;
  border-radius: 5px;
  background-color: #f9f9f9;
}

.audio-conversion label.button {
  display: inline-block;
  padding: 10px 15px;
  background-color: #007bff;
  color: white;
  border-radius: 4px;
  cursor: pointer;
  text-align: center;
}

.audio-conversion label.button:hover {
  background-color: #0056b3;
}

.audio-conversion input[type="file"] {
  width: 0;
  height: 0;
  opacity: 0;
  cursor: pointer;
  display: none; /* This effectively hides it, label acts as proxy */
}

.audio-conversion code {
  background-color: #eee;
  padding: 2px 4px;
  border-radius: 3px;
}

.audio-conversion button {
  padding: 8px 12px;
  margin-right: 10px;
  background-color: #28a745;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.audio-conversion button:hover {
  background-color: #1e7e34;
}

.audio-conversion button:disabled {
  background-color: #ccc;
  cursor: not-allowed;
}

.audio-conversion input[type="range"] {
  width: 200px;
  margin-left: 10px;
}
.audio-conversion div > label {
    display: inline-block;
    min-width: 180px; /* Adjust as needed for alignment */
}

/* Styles for dynamically created player elements */
/* Use :deep() or global styles if these classes are added by Magenta.js directly */
/* For classes added in this component's createPlayer, scoped is fine. */
.player-container {
  margin-top: 10px;
}

.visualizer-container {
  height: 100px; /* Adjust as needed */
  width: 100%;
  overflow-x: auto;
  border: 1px solid #ccc;
  background-color: white;
}

.visualizer-container svg {
  height: 100%;
  min-width: 100%; /* Ensure it can be wider than container for scrolling */
}
.file-results-container, .optimize-results-container {
  margin-top: 10px;
}

/* Ensure details/summary look decent */
details {
  margin-top: 10px;
  padding: 5px;
  border: 1px solid #eee;
  background: #f0f0f0;
}
summary {
  cursor: pointer;
  font-weight: bold;
}
details span {
    display: block;
    padding: 5px;
    background: white;
    margin-top: 5px;
    white-space: pre-wrap; /* Allow wrapping of long note sequences */
    word-break: break-all;
}


</style>