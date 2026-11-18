class MeterSoftClipProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.framesSincePost = 0;
    this.peakL = 0;
    this.peakR = 0;
    this.sumSqL = 0;
    this.sumSqR = 0;
    this.corrNum = 0;
    this.corrDenL = 0;
    this.corrDenR = 0;
    this.clipped = false;
    this.softClipEnabled = true;

    this.port.onmessage = (e) => {
      if (e.data && typeof e.data.softClipEnabled === 'boolean') {
        this.softClipEnabled = e.data.softClipEnabled;
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;

    const inL = input[0];
    const inR = input.length > 1 ? input[1] : input[0];
    const outL = output[0];
    const outR = output.length > 1 ? output[1] : null;
    const len = inL.length;

    for (let i = 0; i < len; i++) {
      let l = inL[i];
      let r = inR[i];

      if (Math.abs(l) >= 0.999 || Math.abs(r) >= 0.999) {
        this.clipped = true;
      }

      if (this.softClipEnabled) {
        if (Math.abs(l) > 0.95) l = Math.tanh(l);
        if (Math.abs(r) > 0.95) r = Math.tanh(r);
      }

      if (outL) outL[i] = l;
      if (outR) outR[i] = r;

      const al = Math.abs(l);
      const ar = Math.abs(r);
      if (al > this.peakL) this.peakL = al;
      if (ar > this.peakR) this.peakR = ar;
      this.sumSqL += l * l;
      this.sumSqR += r * r;
      this.corrNum += l * r;
      this.corrDenL += l * l;
      this.corrDenR += r * r;
    }

    this.framesSincePost += len;
    const updateInterval = Math.max(512, Math.round(sampleRate * 0.04)); // ~25 Hz UI meter
    if (this.framesSincePost >= updateInterval) {
      const n = this.framesSincePost;
      const rmsL = Math.sqrt(this.sumSqL / n);
      const rmsR = Math.sqrt(this.sumSqR / n);
      const den = Math.sqrt(this.corrDenL * this.corrDenR);
      const phase = den > 1e-12 ? Math.max(-1, Math.min(1, this.corrNum / den)) : 1;

      this.port.postMessage({
        peakL: this.peakL,
        peakR: this.peakR,
        rmsL,
        rmsR,
        clipped: this.clipped,
        phase,
      });

      this.framesSincePost = 0;
      this.peakL = 0;
      this.peakR = 0;
      this.sumSqL = 0;
      this.sumSqR = 0;
      this.corrNum = 0;
      this.corrDenL = 0;
      this.corrDenR = 0;
      this.clipped = false;
    }

    return true;
  }
}

registerProcessor('meter-softclip-processor', MeterSoftClipProcessor);
