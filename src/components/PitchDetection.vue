<template>
    <div class="pitch-detection-container">
      <h1>实时音高图表</h1>
  
      <p v-if="initializationError" class="error-message">错误: {{ initializationError }}</p>
      <p v-else-if="!isMicrophoneAllowed && !attemptedInitialization">请点击下方按钮并允许麦克风访问以开始检测。</p>
      <p v-else-if="!isMicrophoneAllowed && attemptedInitialization">麦克风访问被拒绝或失败。请检查浏览器权限并重试。</p>
      <p v-else>{{ isProcessingAudio ? '正在检测音高...' : '检测已暂停。' }}</p>
      
      <!-- **** MODIFICATION HERE: Removed inline style for width/height **** -->
      <div id="container" ref="chartContainerRef"> 
        <!-- Canvas elements' width/height attributes define their drawing buffer size -->
        <canvas id="grid" ref="gridCanvasRef" :width="canvasWidth" :height="canvasHeight"></canvas>
        <canvas id="graph" ref="graphCanvasRef" :width="canvasWidth" :height="canvasHeight"></canvas>
      </div>
      
      <button @click="handleToggleButtonClick" v-if="!initializationError || isMicrophoneAllowed">
        {{ buttonText }}
      </button>
       <p v-if="isMicrophoneAllowed && !isProcessingAudio && attemptedInitialization && !initializationError" style="font-size: 0.9em; margin-top: 5px;">
          点击“{{ buttonText }}”开始。
      </p>
    </div>
  </template>
  
  <script setup lang="ts">
  import { ref, onMounted, onUnmounted, nextTick, computed } from 'vue';
  import AubioModule, { Pitch } from 'aubiojs';
  
  // --- Refs for DOM Elements ---
  const gridCanvasRef = ref<HTMLCanvasElement | null>(null);
  const graphCanvasRef = ref<HTMLCanvasElement | null>(null);
  const chartContainerRef = ref<HTMLDivElement | null>(null);
  
  // --- Canvas Dimensions for DRAWING BUFFER (not display size) ---
  const canvasWidth = ref(300); // Keep this as the internal resolution
  const canvasHeight = ref(450); // Keep this as the internal resolution
  
  // ... (rest of your <script setup> remains largely the same) ...
  // Make sure pitchHistory is initialized with canvasWidth.value
  const pitchHistory = ref<Array<number | null>>(new Array(canvasWidth.value).fill(null));
  
  // --- Constants & State (no changes needed here related to responsiveness) ---
  const fullMinMidi = 21;
  const fullMaxMidi = 108;
  const displayOctaves = 3;
  const displayRange = displayOctaves * 12;
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  
  const latestFrequency = ref<number | null>(null);
  const pitchSmoothed = ref<number>(0);
  const PITCH_SMOOTHING_FACTOR = 0.85;
  const axisCenterMidiSmoothed = ref<number>((fullMinMidi + fullMaxMidi) / 2);
  const AXIS_SMOOTHING_FACTOR = 0.99;
  
  let audioContext: AudioContext | null = null;
  let mediaStreamSource: MediaStreamAudioSourceNode | null = null;
  let workletNode: AudioWorkletNode | null = null;
  let pitchDetector: Pitch | null = null;
  let audioBufferAccumulator = new Float32Array(4096);
  let accumulatorIndex = 0;
  let animationFrameId: number | null = null;
  let mediaStream: MediaStream | null = null;
  
  const isMicrophoneAllowed = ref(false);
  const initializationError = ref<string | null>(null);
  const isProcessingAudio = ref(false);
  const attemptedInitialization = ref(false);
  
  let gridCtx: CanvasRenderingContext2D | null = null;
  let graphCtx: CanvasRenderingContext2D | null = null;
  
  
  const buttonText = computed(() => {
    if (!attemptedInitialization.value && !isMicrophoneAllowed.value) return '开始检测 (需要麦克风)';
    if (initializationError.value && !isMicrophoneAllowed.value) return '重试授权并开始';
    return isProcessingAudio.value ? '暂停检测' : '开始检测';
  });
  
  function frequencyToMidi(frequency: number): number | null {
    if (frequency <= 0) return null;
    return 69 + 12 * Math.log2(frequency / 440);
  }
  
  function drawDynamicGrid(windowMinMidi: number, windowMaxMidi: number) {
    if (!gridCtx) return;
    // canvasWidth.value and canvasHeight.value are the drawing buffer dimensions
    gridCtx.clearRect(0, 0, canvasWidth.value, canvasHeight.value);
    const startMidi = Math.floor(windowMinMidi);
    const endMidi = Math.ceil(windowMaxMidi);
  
    for (let midi = startMidi; midi <= endMidi; midi++) {
      let y = canvasHeight.value - ((midi - windowMinMidi) / (windowMaxMidi - windowMinMidi)) * canvasHeight.value;
      let nextMidi = midi + 1;
      let nextY = canvasHeight.value - ((nextMidi - windowMinMidi) / (windowMaxMidi - windowMinMidi)) * canvasHeight.value;
      if (y > nextY) {
        gridCtx.fillStyle = (midi % 2 === 0) ? '#f9f9f9' : '#ffffff';
        gridCtx.fillRect(0, nextY, canvasWidth.value, y - nextY);
      }
    }
  
    for (let midi = startMidi; midi <= endMidi; midi++) {
      let y = canvasHeight.value - ((midi - windowMinMidi) / (windowMaxMidi - windowMinMidi)) * canvasHeight.value;
      gridCtx.beginPath();
      gridCtx.moveTo(0, y);
      gridCtx.lineTo(canvasWidth.value, y);
      gridCtx.strokeStyle = '#ccc';
      gridCtx.lineWidth = 1; // This line thickness will also scale with the CSS
      gridCtx.stroke();
      let noteIndex = midi % 12;
      let octave = Math.floor(midi / 12) - 1;
      let noteName = noteNames[noteIndex];
      if (noteName.indexOf('#') === -1) {
        gridCtx.fillStyle = 'black';
        gridCtx.font = '12px Arial'; // Font size will also scale
        gridCtx.textAlign = 'left';
        gridCtx.fillText(noteName + octave, 5, y - 3);
      }
    }
  }
  
  function drawGraph(currentPitchHistory: Array<number | null>, windowMinMidi: number, windowMaxMidi: number) {
    if (!graphCtx) return;
    graphCtx.clearRect(0, 0, canvasWidth.value, canvasHeight.value);
    graphCtx.beginPath();
    let started = false;
    for (let i = 0; i < currentPitchHistory.length; i++) {
      let midi = currentPitchHistory[i];
      // x is based on the drawing buffer width
      let x = canvasWidth.value - currentPitchHistory.length + i; 
  
      if (midi === null) {
        if (started) {
          graphCtx.stroke();
          started = false;
        }
        continue;
      }
  
      let y = canvasHeight.value - ((midi - windowMinMidi) / (windowMaxMidi - windowMinMidi)) * canvasHeight.value;
      y = Math.max(0, Math.min(canvasHeight.value, y));
  
      if (!started) {
        graphCtx.moveTo(x, y);
        started = true;
      } else {
        graphCtx.lineTo(x, y);
      }
    }
    if (started) {
      graphCtx.strokeStyle = 'red';
      graphCtx.lineWidth = 2; // This line thickness will also scale
      graphCtx.stroke();
    }
  }
  
  function update() {
    animationFrameId = requestAnimationFrame(update); 
  
    let currentMidi: number | null = null;
    if (isProcessingAudio.value && latestFrequency.value !== null && latestFrequency.value > 0) {
      if (pitchSmoothed.value === 0) {
        pitchSmoothed.value = latestFrequency.value;
      } else {
        pitchSmoothed.value = pitchSmoothed.value * PITCH_SMOOTHING_FACTOR + latestFrequency.value * (1 - PITCH_SMOOTHING_FACTOR);
      }
      currentMidi = frequencyToMidi(pitchSmoothed.value);
  
      if (currentMidi !== null) {
        axisCenterMidiSmoothed.value = axisCenterMidiSmoothed.value * AXIS_SMOOTHING_FACTOR + currentMidi * (1 - AXIS_SMOOTHING_FACTOR);
      }
    } else {
      currentMidi = null; 
    }
  
    const newHistory = [...pitchHistory.value];
    newHistory.push(currentMidi);
    // pitchHistory length is tied to canvasWidth.value (drawing buffer width)
    if (newHistory.length > canvasWidth.value) { 
      newHistory.shift();
    }
    pitchHistory.value = newHistory;
  
    let windowMinMidi = axisCenterMidiSmoothed.value - displayRange / 2;
    let windowMaxMidi = axisCenterMidiSmoothed.value + displayRange / 2;
  
    if (windowMinMidi < fullMinMidi) {
      windowMinMidi = fullMinMidi;
      windowMaxMidi = fullMinMidi + displayRange;
    } else if (windowMaxMidi > fullMaxMidi) {
      windowMaxMidi = fullMaxMidi;
      windowMinMidi = fullMaxMidi - displayRange;
    }
  
    drawDynamicGrid(windowMinMidi, windowMaxMidi);
    drawGraph(pitchHistory.value, windowMinMidi, windowMaxMidi);
  }
  
  async function initAudio() {
    attemptedInitialization.value = true;
    initializationError.value = null; 
  
    if (audioContext && audioContext.state !== 'closed') {
       if (audioContext.state === 'suspended') {
          await audioContext.resume();
          isProcessingAudio.value = true;
          return;
       }
       if (isProcessingAudio.value) return; 
    } else { 
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        isMicrophoneAllowed.value = true;
  
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        
        await audioContext.audioWorklet.addModule('/NotaFlow/pitch-processor.js'); 
        
        mediaStreamSource = audioContext.createMediaStreamSource(mediaStream);
        workletNode = new AudioWorkletNode(audioContext, 'pitch-processor');
        
        mediaStreamSource.connect(workletNode);
  
        const aubio = await AubioModule();
        pitchDetector = new aubio.Pitch("fcomb", 4096 * 4, 4096, audioContext.sampleRate);
  
        accumulatorIndex = 0;
  
        workletNode.port.onmessage = (event) => {
          if (!isProcessingAudio.value || !audioContext || audioContext.state !== 'running') return;
  
          const samples = event.data as Float32Array;
          let currentInputPos = 0;
          while(currentInputPos < samples.length) {
              const toCopy = Math.min(samples.length - currentInputPos, 4096 - accumulatorIndex);
              audioBufferAccumulator.set(samples.slice(currentInputPos, currentInputPos + toCopy), accumulatorIndex);
              accumulatorIndex += toCopy;
              currentInputPos += toCopy;
  
              if (accumulatorIndex >= 4096 && pitchDetector) {
                  const frequency = pitchDetector.do(audioBufferAccumulator);
                  latestFrequency.value = frequency > 0 ? frequency : null;
                  accumulatorIndex = 0; 
              }
          }
        };
      
      } catch (e: any) {
        console.error('Error accessing audio stream or initializing audio:', e);
        if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
          initializationError.value = `麦克风访问被拒绝。请在浏览器设置中允许访问。`;
        } else {
          initializationError.value = `无法初始化音频: ${e.message}`;
        }
        isMicrophoneAllowed.value = false;
        isProcessingAudio.value = false; 
        return; 
      }
    }
    isProcessingAudio.value = true;
    if (audioContext?.state === 'suspended') { 
      await audioContext.resume();
    }
  }
  
  async function handleToggleButtonClick() {
    if (!audioContext || audioContext.state === 'closed' || initializationError.value || !isMicrophoneAllowed.value) {
      await initAudio();
    } else {
      isProcessingAudio.value = !isProcessingAudio.value;
      if (isProcessingAudio.value) {
        if (audioContext.state === 'suspended') {
          await audioContext.resume();
        }
        latestFrequency.value = null; 
        pitchSmoothed.value = 0;
      } else {
        latestFrequency.value = null;
      }
    }
  }
  
  onMounted(async () => {
    await nextTick();
    if (gridCanvasRef.value && graphCanvasRef.value) {
      gridCtx = gridCanvasRef.value.getContext('2d');
      graphCtx = graphCanvasRef.value.getContext('2d');
      
      // The :width and :height on canvas elements already set their drawing buffer.
      // CSS will handle their display size.
  
      // Initialize pitchHistory based on the drawing buffer width
      pitchHistory.value = new Array(canvasWidth.value).fill(null);
  
      if (animationFrameId === null) {
          animationFrameId = requestAnimationFrame(update);
      }
    } else {
      console.error("Canvas elements not found!");
      initializationError.value = "关键Canvas元素未找到，无法渲染图表!";
    }
  });
  
  onUnmounted(() => {
    isProcessingAudio.value = false;
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    
    workletNode?.port.close();
    try { workletNode?.disconnect(); } catch(e) { /* ignore */ }
    try { mediaStreamSource?.disconnect(); } catch(e) { /* ignore */ }
    mediaStream?.getTracks().forEach(track => track.stop());
    
    if (audioContext && audioContext.state !== 'closed') {
      audioContext.close().catch(e => console.error("Error closing AudioContext:", e));
    }
    audioContext = null;
    pitchDetector = null; 
  });
  
  </script>
  

  <style scoped>
.pitch-detection-container {
  display: flex;
  flex-direction: column;
  align-items: center; /* 水平居中子元素 */
  justify-content: flex-start; /* 从顶部开始排列 */
  padding: 10px 20px; /* 减少上下padding */
  background: #f0f0f0;
  font-family: Arial, sans-serif;
  min-height: 100vh;
  width: 100%; /* 确保容器占据全部可用宽度 */
  box-sizing: border-box; /* 确保 padding 不会增加总宽度 */
}

/* **** MODIFIED CSS for #container **** */
#container {
  position: relative;
  /* Make it responsive: take up most of viewport width on mobile, up to a max on desktop */
  width: 90vw; /* 90% of viewport width */
  max-width: 300px; /* Maximum width it can take (original canvas width) */
  
  /* Maintain aspect ratio of the drawing buffer (e.g., 300/450 = 4/3) */
  /* aspect-ratio: calc(v-bind(canvasWidth) / v-bind(canvasHeight)); */ /* Vue 3.2+ CSS v-bind */
  aspect-ratio: 300 / 450; /* Hardcode if v-bind not available or preferred */

  margin: 20px 0; /* 上下边距20px, 水平边距由父flex容器的align-items控制 */
                 /* 如果需要强制使用 margin: auto 来水平居中，可以保留 margin: 20px auto; */
                 /* 但在flex子项中，align-items: center 通常足够 */
  border: 1px solid #000;
  background: #fff;
  overflow: hidden; 
}

/* **** MODIFIED CSS for canvas **** */
canvas {
  position: absolute;
  top: 0;
  left: 0;
  /* Make canvas fill its responsive parent container */
  width: 100%;
  height: 100%;
  display: block; 
}

h1 {
  text-align: center; /* 文本在其块内居中 */
  margin: 5px 0; /* 减少上下margin */
  font-size: 1.2em; /* 稍微减小字体大小 */
}


p {
  text-align: center; /* 文本在其块内居中 */
  margin-top: 5px;
  margin-bottom: 15px;
  max-width: 90vw; /* Ensure text also wraps nicely */
  font-size: 0.9em;
}

.error-message {
  color: red;
  font-weight: bold;
}
button {
  margin-top: 5px;
  padding: 10px 15px; /* Slightly smaller padding for mobile */
  font-size: 0.9em; /* Responsive font size */
  cursor: pointer;
  background-color: #4CAF50;
  color: white;
  border: none;
  border-radius: 5px;
  transition: background-color 0.2s ease-in-out;
}

button:hover {
  background-color: #45a049;
}
button:disabled {
  background-color: #ccc;
  cursor: not-allowed;
}
</style>