// Define an AudioWorkletProcessor to forward audio samples to the main thread.
class PitchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
  }

  process(inputs, outputs, parameters) {
    // Assume mono input; get first channel from first input
    const input = inputs[0];
    if (input && input[0]) {
      // Send the current frame (Float32Array) to the main thread
      this.port.postMessage(input[0]);
    }
    // Return true to keep the processor alive
    return true;
  }
}

// Register the processor under the name 'pitch-processor'
registerProcessor('pitch-processor', PitchProcessor);
