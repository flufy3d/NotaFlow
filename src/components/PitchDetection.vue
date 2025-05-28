<template>
    <div class="pitch-detection-container">
      <h1>实时音高图表 (Vue 3 + AudioWorklet)</h1>
  
      <p v-if="initializationError" class="error-message">错误: {{ initializationError }}</p>
      <p v-else-if="!isMicrophoneAllowed && !attemptedInitialization">请点击下方按钮并允许麦克风访问以开始检测。</p>
      <p v-else-if="!isMicrophoneAllowed && attemptedInitialization">麦克风访问被拒绝或失败。请检查浏览器权限并重试。</p>
      <p v-else>{{ isProcessingAudio ? '正在检测音高...' : '检测已暂停。' }} 此版本旨在减少图表抖动。</p>
      
      <!-- **** MODIFICATION HERE: Bind style for width and height **** -->
      <div id="container" ref="chartContainerRef" :style="{ width: canvasWidth + 'px', height: canvasHeight + 'px' }">
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
  
  const gridCanvasRef = ref<HTMLCanvasElement | null>(null);
  const graphCanvasRef = ref<HTMLCanvasElement | null>(null);
  const chartContainerRef = ref<HTMLDivElement | null>(null); // Keep if needed for other manipulations
  
  const canvasWidth = ref(800);
  const canvasHeight = ref(600);
  
  let gridCtx: CanvasRenderingContext2D | null = null;
  let graphCtx: CanvasRenderingContext2D | null = null;
  
  const fullMinMidi = 21;
  const fullMaxMidi = 108;
  const displayOctaves = 3;
  const displayRange = displayOctaves * 12;
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  
  const pitchHistory = ref<Array<number | null>>(new Array(canvasWidth.value).fill(null));
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
  const attemptedInitialization = ref(false); // To track if user tried to init
  
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
    gridCtx.clearRect(0, 0, canvasWidth.value, canvasHeight.value);
    const startMidi = Math.floor(windowMinMidi);
    const endMidi = Math.ceil(windowMaxMidi);
  
    for (let midi = startMidi; midi <= endMidi; midi++) {
      let y = canvasHeight.value - ((midi - windowMinMidi) / (windowMaxMidi - windowMinMidi)) * canvasHeight.value;
      let nextMidi = midi + 1;
      let nextY = canvasHeight.value - ((nextMidi - windowMinMidi) / (windowMaxMidi - windowMinMidi)) * canvasHeight.value;
      if (y > nextY) {
        gridCtx.fillStyle = (midi % 12 === 1 || midi % 12 === 3 || midi % 12 === 6 || midi % 12 === 8 || midi % 12 === 10) ? '#f0f0f0' : '#ffffff'; // Slightly different shading for black keys areas
        gridCtx.fillStyle = (midi % 2 === 0) ? '#f9f9f9' : '#ffffff'; // Original logic
        gridCtx.fillRect(0, nextY, canvasWidth.value, y - nextY);
      }
    }
  
    for (let midi = startMidi; midi <= endMidi; midi++) {
      let y = canvasHeight.value - ((midi - windowMinMidi) / (windowMaxMidi - windowMinMidi)) * canvasHeight.value;
      gridCtx.beginPath();
      gridCtx.moveTo(0, y);
      gridCtx.lineTo(canvasWidth.value, y);
      gridCtx.strokeStyle = '#ccc';
      gridCtx.lineWidth = 1;
      gridCtx.stroke();
      let noteIndex = midi % 12;
      let octave = Math.floor(midi / 12) - 1;
      let noteName = noteNames[noteIndex];
      if (noteName.indexOf('#') === -1) {
        gridCtx.fillStyle = 'black';
        gridCtx.font = '12px Arial';
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
      graphCtx.lineWidth = 2;
      graphCtx.stroke();
    }
  }
  
  function update() {
    animationFrameId = requestAnimationFrame(update); // Re-queue at the beginning
  
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
      currentMidi = null; // Ensure line fades if not processing or no frequency
    }
  
    const newHistory = [...pitchHistory.value];
    newHistory.push(currentMidi);
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
    initializationError.value = null; // Clear previous errors
  
    if (audioContext && audioContext.state !== 'closed') {
      // Already initialized or in process, maybe just resume
       if (audioContext.state === 'suspended') {
          await audioContext.resume();
          isProcessingAudio.value = true;
          return;
       }
       if (isProcessingAudio.value) return; // Already processing
    } else { // Full initialization needed
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        isMicrophoneAllowed.value = true;
  
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        
        await audioContext.audioWorklet.addModule('/pitch-processor.js'); // Path from public root
        
        mediaStreamSource = audioContext.createMediaStreamSource(mediaStream);
        workletNode = new AudioWorkletNode(audioContext, 'pitch-processor');
        
        mediaStreamSource.connect(workletNode);
        // workletNode.connect(audioContext.destination); // Not connecting to output
  
        const aubio = await AubioModule();
        pitchDetector = new aubio.Pitch("fcomb", 4096 * 4, 4096, audioContext.sampleRate);
  
        accumulatorIndex = 0;
  
        workletNode.port.onmessage = (event) => {
          if (!isProcessingAudio.value || !audioContext || audioContext.state !== 'running') return;
  
          const samples = event.data as Float32Array;
          // Buffer accumulation logic (ensure it doesn't process if already full before this message)
          let currentInputPos = 0;
          while(currentInputPos < samples.length) {
              const toCopy = Math.min(samples.length - currentInputPos, 4096 - accumulatorIndex);
              audioBufferAccumulator.set(samples.slice(currentInputPos, currentInputPos + toCopy), accumulatorIndex);
              accumulatorIndex += toCopy;
              currentInputPos += toCopy;
  
              if (accumulatorIndex >= 4096 && pitchDetector) {
                  const frequency = pitchDetector.do(audioBufferAccumulator);
                  latestFrequency.value = frequency > 0 ? frequency : null;
                  accumulatorIndex = 0; // Reset for next block
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
        isProcessingAudio.value = false; // Ensure it's set to false on error
        return; // Stop if initialization failed
      }
    }
    // If successful or resumed
    isProcessingAudio.value = true;
    if (audioContext?.state === 'suspended') { // Double check state after potential resume
      await audioContext.resume();
    }
  }
  
  async function handleToggleButtonClick() {
    if (!audioContext || audioContext.state === 'closed' || initializationError.value || !isMicrophoneAllowed.value) {
      // If not initialized, or error occurred, or mic not allowed (but user clicks button implying intent)
      await initAudio();
      // initAudio will set isProcessingAudio.value to true if successful
    } else {
      // Toggle processing state
      isProcessingAudio.value = !isProcessingAudio.value;
      if (isProcessingAudio.value) {
        if (audioContext.state === 'suspended') {
          await audioContext.resume();
        }
        latestFrequency.value = null; // Reset to avoid stale data jump
        pitchSmoothed.value = 0;
      } else {
        latestFrequency.value = null;
        // When pausing, audioContext might suspend on its own if no nodes are pulling data.
        // Or we could explicitly suspend: audioContext.suspend(); but this might be too aggressive.
      }
    }
  }
  
  onMounted(async () => {
    await nextTick();
    if (gridCanvasRef.value && graphCanvasRef.value) {
      gridCtx = gridCanvasRef.value.getContext('2d');
      graphCtx = graphCanvasRef.value.getContext('2d');
      
      gridCanvasRef.value.width = canvasWidth.value;
      gridCanvasRef.value.height = canvasHeight.value;
      graphCanvasRef.value.width = canvasWidth.value;
      graphCanvasRef.value.height = canvasHeight.value;
  
      pitchHistory.value = new Array(canvasWidth.value).fill(null);
  
      // Start the drawing loop regardless of audio state
      // It will draw an empty grid/graph if audio isn't active
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
    pitchDetector = null; // Release AubioJS object
  });
  
  </script>
  
  <style scoped>
  .pitch-detection-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 20px;
    background: #f0f0f0;
    font-family: Arial, sans-serif;
    min-height: 100vh; /* Ensure it takes full viewport height if content is short */
  }
  
  /* Styles for the container of canvases */
  #container {
    position: relative;
    /* width and height are now set by :style binding */
    margin: 20px auto;
    border: 1px solid #000;
    background: #fff;
    overflow: hidden; /* Important to clip canvas if it ever draws outside bounds by mistake */
  }
  
  canvas {
    position: absolute;
    top: 0;
    left: 0;
    display: block; /* Can help avoid minor layout issues with inline canvas */
  }
  
  h1 {
    text-align: center;
    margin-bottom: 10px;
  }
  p {
    text-align: center;
    margin-top: 5px;
    margin-bottom: 15px;
    max-width: 800px; /* Match canvas width for consistency */
  }
  .error-message {
    color: red;
    font-weight: bold;
  }
  button {
    margin-top: 5px; /* Reduced margin from container */
    padding: 10px 20px;
    font-size: 16px;
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