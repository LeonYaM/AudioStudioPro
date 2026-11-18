/**
 * Real-time low-latency AudioWorkletProcessor implementing full TrackEffectRack DSP:
 * Gate/Expander -> 10-band Graphic EQ -> De-Esser -> Multiband 3-band ->
 * Saturation/Distortion/Exciter -> Modulation (Chorus/Flanger/Phaser/Tremolo/Vibrato) ->
 * Stereo Widener -> Schroeder Stereo Reverb -> Brickwall Limiter.
 */
class DspRackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.rack = null;

    // Gate/Expander state
    this.gateEnv = 0;

    // 10-band Graphic EQ biquad states [band][ch]
    this.geqFreqs = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    this.geqCoeffs = [];
    this.geqZ1 = Array.from({ length: 10 }, () => [0, 0]);
    this.geqZ2 = Array.from({ length: 10 }, () => [0, 0]);

    // De-esser state
    this.deEssLp = [0, 0];
    this.deEssEnvDb = -120;

    // Multiband 3-band state
    this.mbLowCoeff = null;
    this.mbHighCoeff = null;
    this.mbLowZ = [[0, 0], [0, 0]];
    this.mbHighZ = [[0, 0], [0, 0]];
    this.mbEnvDb = [-120, -120, -120];

    // Exciter HP state
    this.excLp = [0, 0];

    // Modulation ring buffers & LFO phase
    const maxModSamples = Math.ceil(0.04 * sampleRate);
    this.modBuf = [new Float32Array(maxModSamples), new Float32Array(maxModSamples)];
    this.modWrite = 0;
    this.modPhase = 0;
    this.phaserZm = [new Float32Array(4), new Float32Array(4)];

    // Schroeder Reverb buffers
    const scale = sampleRate / 44100;
    const combLens = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
    const apLens = [556, 441, 341, 225];
    this.combs = [0, 1].map((ch) =>
      combLens.map((len) => ({
        buf: new Float32Array(Math.max(16, Math.round((len + ch * 23) * scale))),
        idx: 0,
        store: 0,
      }))
    );
    this.allpasses = [0, 1].map((ch) =>
      apLens.map((len) => ({
        buf: new Float32Array(Math.max(8, Math.round((len + ch * 23) * scale))),
        idx: 0,
      }))
    );
    const maxPre = Math.ceil(0.15 * sampleRate);
    this.preBuf = [new Float32Array(maxPre), new Float32Array(maxPre)];
    this.preIdx = 0;

    // Limiter state
    this.limGain = 1;

    this.port.onmessage = (e) => {
      if (e.data && e.data.rack) {
        this.updateRack(e.data.rack);
      }
    };
  }

  computeBiquad(type, freq, gainDb, q) {
    const f = Math.max(10, Math.min(sampleRate * 0.48, freq));
    const w0 = (2 * Math.PI * f) / sampleRate;
    const cosW0 = Math.cos(w0);
    const sinW0 = Math.sin(w0);
    const alpha = sinW0 / (2 * Math.max(0.1, q));
    const A = Math.pow(10, gainDb / 40);

    let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
    if (type === 'peaking') {
      b0 = 1 + alpha * A;
      b1 = -2 * cosW0;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cosW0;
      a2 = 1 - alpha / A;
    } else if (type === 'lowpass') {
      b0 = (1 - cosW0) / 2;
      b1 = 1 - cosW0;
      b2 = (1 - cosW0) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosW0;
      a2 = 1 - alpha;
    } else if (type === 'highpass') {
      b0 = (1 + cosW0) / 2;
      b1 = -(1 + cosW0);
      b2 = (1 + cosW0) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosW0;
      a2 = 1 - alpha;
    }
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
  }

  updateRack(rack) {
    this.rack = rack;
    if (rack.graphicEq && rack.graphicEq.enabled) {
      this.geqCoeffs = this.geqFreqs.map((f, i) => {
        const g = rack.graphicEq.bandsDb[i] || 0;
        return Math.abs(g) >= 0.05 ? this.computeBiquad('peaking', f, g, 1.41) : null;
      });
    } else {
      this.geqCoeffs = [];
    }
    if (rack.multiband && rack.multiband.enabled) {
      this.mbLowCoeff = this.computeBiquad('lowpass', rack.multiband.lowCrossHz, 0, 0.707);
      this.mbHighCoeff = this.computeBiquad('highpass', rack.multiband.highCrossHz, 0, 0.707);
    }
  }

  runBiquad(x, c, z1Arr, z2Arr, ch) {
    const y = c.b0 * x + z1Arr[ch];
    z1Arr[ch] = c.b1 * x - c.a1 * y + z2Arr[ch];
    z2Arr[ch] = c.b2 * x - c.a2 * y;
    return y;
  }

  linToDb(v) {
    return v <= 1e-6 ? -120 : 20 * Math.log10(v);
  }

  dbToLin(db) {
    return db <= -120 ? 0 : Math.pow(10, db / 20);
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0 || !output || output.length === 0) return true;

    const inL = input[0];
    const inR = input.length > 1 ? input[1] : input[0];
    const outL = output[0];
    const outR = output.length > 1 ? output[1] : output[0];
    const len = inL.length;

    const rack = this.rack;
    if (!rack) {
      outL.set(inL);
      if (output.length > 1) outR.set(inR);
      return true;
    }

    const gate = rack.gate;
    const gateAtk = gate ? Math.exp(-1 / Math.max(1, (gate.attackMs / 1000) * sampleRate)) : 0;
    const gateRel = gate ? Math.exp(-1 / Math.max(1, (gate.releaseMs / 1000) * sampleRate)) : 0;

    const deEss = rack.deEsser;
    const deEssRc = deEss ? 1 / (2 * Math.PI * Math.max(1000, deEss.frequencyHz * 0.85)) : 1;
    const deEssAlpha = deEss ? (1 / sampleRate) / (deEssRc + 1 / sampleRate) : 0;
    const deEssAtk = Math.exp(-1 / Math.max(1, 0.002 * sampleRate));
    const deEssRel = Math.exp(-1 / Math.max(1, 0.05 * sampleRate));

    const mb = rack.multiband;
    const sat = rack.saturation;
    const mod = rack.modulation;
    const wide = rack.widener;
    const rev = rack.reverb;
    const lim = rack.limiter;

    const preDelayLen = rev && rev.enabled ? Math.min(this.preBuf[0].length - 1, Math.max(1, Math.round((rev.preDelayMs / 1000) * sampleRate))) : 1;
    const revFb = rev ? 0.72 + rev.roomSize * 0.23 : 0;
    const revDamp1 = rev ? rev.damping * 0.5 : 0;
    const revDamp2 = 1 - revDamp1;

    const limCeiling = lim && lim.enabled ? this.dbToLin(lim.ceilingDb) : 1;
    const limRel = lim && lim.enabled ? Math.exp(-1 / Math.max(1, (lim.releaseMs / 1000) * sampleRate)) : 0;

    for (let i = 0; i < len; i++) {
      let l = inL[i];
      let r = inR[i];

      // 1. Gate / Expander
      if (gate && gate.enabled) {
        const pk = Math.max(Math.abs(l), Math.abs(r));
        const coef = pk > this.gateEnv ? gateAtk : gateRel;
        this.gateEnv = coef * this.gateEnv + (1 - coef) * pk;
        const envDb = this.linToDb(this.gateEnv);
        if (envDb < gate.thresholdDb) {
          const gDb =
            gate.mode === 'gate'
              ? gate.rangeDb
              : Math.max(gate.rangeDb, -(gate.thresholdDb - envDb) * (gate.ratio - 1));
          const g = this.dbToLin(gDb);
          l *= g;
          r *= g;
        }
      }

      // 2. 10-band Graphic EQ
      if (this.geqCoeffs.length > 0) {
        for (let b = 0; b < 10; b++) {
          const c = this.geqCoeffs[b];
          if (!c) continue;
          l = this.runBiquad(l, c, this.geqZ1[b], this.geqZ2[b], 0);
          r = this.runBiquad(r, c, this.geqZ1[b], this.geqZ2[b], 1);
        }
      }

      // 3. De-Esser (phase-complementary split)
      if (deEss && deEss.enabled) {
        this.deEssLp[0] += deEssAlpha * (l - this.deEssLp[0]);
        this.deEssLp[1] += deEssAlpha * (r - this.deEssLp[1]);
        const hiL = l - this.deEssLp[0];
        const hiR = r - this.deEssLp[1];
        const scDb = this.linToDb(Math.max(Math.abs(hiL), Math.abs(hiR)));
        const coef = scDb > this.deEssEnvDb ? deEssAtk : deEssRel;
        this.deEssEnvDb = coef * this.deEssEnvDb + (1 - coef) * scDb;
        if (this.deEssEnvDb > deEss.thresholdDb) {
          const red = Math.min(Math.abs(deEss.reductionDb), (this.deEssEnvDb - deEss.thresholdDb) * 0.75);
          const g = this.dbToLin(-red);
          l = this.deEssLp[0] + hiL * g;
          r = this.deEssLp[1] + hiR * g;
        }
      }

      // 4. Multiband 3-Band Compressor
      if (mb && mb.enabled && this.mbLowCoeff && this.mbHighCoeff) {
        const lowL = this.runBiquad(l, this.mbLowCoeff, this.mbLowZ[0], this.mbLowZ[1], 0);
        const lowR = this.runBiquad(r, this.mbLowCoeff, this.mbLowZ[0], this.mbLowZ[1], 1);
        const highL = this.runBiquad(l, this.mbHighCoeff, this.mbHighZ[0], this.mbHighZ[1], 0);
        const highR = this.runBiquad(r, this.mbHighCoeff, this.mbHighZ[0], this.mbHighZ[1], 1);
        const midL = l - lowL - highL;
        const midR = r - lowR - highR;

        const bands = [
          [lowL, lowR, mb.lowThresholdDb],
          [midL, midR, mb.midThresholdDb],
          [highL, highR, mb.highThresholdDb],
        ];
        const makeup = this.dbToLin(mb.makeupDb);
        let sumL = 0, sumR = 0;
        for (let b = 0; b < 3; b++) {
          const inDb = this.linToDb(Math.max(Math.abs(bands[b][0]), Math.abs(bands[b][1])));
          const c = inDb > this.mbEnvDb[b] ? 0.99 : 0.9995;
          this.mbEnvDb[b] = c * this.mbEnvDb[b] + (1 - c) * inDb;
          let gDb = 0;
          if (this.mbEnvDb[b] > bands[b][2]) {
            gDb = (this.mbEnvDb[b] - bands[b][2]) * (1 / mb.ratio - 1);
          }
          const g = this.dbToLin(gDb) * makeup;
          sumL += bands[b][0] * g;
          sumR += bands[b][1] * g;
        }
        l = sumL;
        r = sumR;
      }

      // 5. Saturation / Distortion / Exciter
      if (sat && sat.enabled && sat.drive > 0.001) {
        const drv = 1 + sat.drive * (sat.mode === 'distortion' ? 18 : 6);
        if (sat.mode === 'exciter') {
          const rc = 1 / (2 * Math.PI * Math.max(1200, sat.toneHz * 0.4));
          const a = (1 / sampleRate) / (rc + 1 / sampleRate);
          this.excLp[0] += a * (l - this.excLp[0]);
          this.excLp[1] += a * (r - this.excLp[1]);
          const hiL = Math.tanh((l - this.excLp[0]) * drv) / Math.tanh(drv);
          const hiR = Math.tanh((r - this.excLp[1]) * drv) / Math.tanh(drv);
          l += hiL * sat.mix * 0.45;
          r += hiR * sat.mix * 0.45;
        } else {
          const sL =
            sat.mode === 'distortion'
              ? (2 / Math.PI) * Math.atan(l * drv)
              : Math.tanh(l * drv) / Math.tanh(drv);
          const sR =
            sat.mode === 'distortion'
              ? (2 / Math.PI) * Math.atan(r * drv)
              : Math.tanh(r * drv) / Math.tanh(drv);
          l = l * (1 - sat.mix) + sL * sat.mix;
          r = r * (1 - sat.mix) + sR * sat.mix;
        }
      }

      // 6. Modulation (Chorus, Flanger, Phaser, Tremolo, Vibrato)
      if (mod && mod.enabled && mod.mix > 0.001) {
        const lfoL = 0.5 + 0.5 * Math.sin(this.modPhase);
        const lfoR = 0.5 + 0.5 * Math.sin(this.modPhase + 1.1);
        this.modPhase += (2 * Math.PI * mod.rateHz) / sampleRate;
        if (this.modPhase > Math.PI * 2) this.modPhase -= Math.PI * 2;

        if (mod.type === 'tremolo') {
          const g = 1 - mod.depth * (1 - lfoL);
          l = l * (1 - mod.mix) + l * g * mod.mix;
          r = r * (1 - mod.mix) + r * g * mod.mix;
        } else if (mod.type === 'phaser') {
          const fL = 300 + lfoL * mod.depth * 3200;
          const fR = 300 + lfoR * mod.depth * 3200;
          const aL = (1 - (fL * 2) / sampleRate) / (1 + (fL * 2) / sampleRate);
          const aR = (1 - (fR * 2) / sampleRate) / (1 + (fR * 2) / sampleRate);
          let yL = l, yR = r;
          for (let s = 0; s < 4; s++) {
            const nL = aL * yL + this.phaserZm[0][s];
            this.phaserZm[0][s] = yL - aL * nL;
            yL = nL;
            const nR = aR * yR + this.phaserZm[1][s];
            this.phaserZm[1][s] = yR - aR * nR;
            yR = nR;
          }
          l = l * (1 - mod.mix * 0.5) + yL * mod.mix * 0.5;
          r = r * (1 - mod.mix * 0.5) + yR * mod.mix * 0.5;
        } else {
          const maxMs = mod.type === 'flanger' ? 8 : mod.type === 'vibrato' ? 10 : 28;
          const baseMs = mod.type === 'flanger' ? 2 : mod.type === 'vibrato' ? 5 : 14;
          const bufLen = this.modBuf[0].length;
          const fb = mod.type === 'flanger' ? 0.45 : 0;

          const readSample = (ch, lfoVal, inp) => {
            const dSamples = ((baseMs + lfoVal * mod.depth * (maxMs - baseMs)) / 1000) * sampleRate;
            let rp = this.modWrite - dSamples;
            if (rp < 0) rp += bufLen;
            const i0 = Math.floor(rp) % bufLen;
            const i1 = (i0 + 1) % bufLen;
            const frac = rp - Math.floor(rp);
            const del = this.modBuf[ch][i0] * (1 - frac) + this.modBuf[ch][i1] * frac;
            this.modBuf[ch][this.modWrite] = inp + del * fb;
            return del;
          };

          const dL = readSample(0, lfoL, l);
          const dR = readSample(1, lfoR, r);
          this.modWrite = (this.modWrite + 1) % bufLen;
          if (mod.type === 'vibrato') {
            l = l * (1 - mod.mix) + dL * mod.mix;
            r = r * (1 - mod.mix) + dR * mod.mix;
          } else {
            l = l * (1 - mod.mix * 0.5) + (l + dL) * 0.5 * mod.mix;
            r = r * (1 - mod.mix * 0.5) + (r + dR) * 0.5 * mod.mix;
          }
        }
      }

      // 7. Stereo Widener
      if (wide && wide.enabled && Math.abs(wide.width - 1) >= 0.01) {
        const mid = 0.5 * (l + r);
        const side = 0.5 * (l - r) * wide.width;
        l = mid + side;
        r = mid - side;
      }

      // 8. Schroeder Stereo Reverb
      if (rev && rev.enabled && rev.mix > 0.001) {
        const preL = this.preBuf[0][this.preIdx];
        const preR = this.preBuf[1][this.preIdx];
        this.preBuf[0][this.preIdx] = l;
        this.preBuf[1][this.preIdx] = r;
        this.preIdx = (this.preIdx + 1) % preDelayLen;

        const runVerb = (ch, inp) => {
          let acc = 0;
          const combs = this.combs[ch];
          for (let k = 0; k < combs.length; k++) {
            const c = combs[k];
            const out = c.buf[c.idx];
            c.store = out * revDamp2 + c.store * revDamp1;
            c.buf[c.idx] = inp * 0.15 + c.store * revFb;
            c.idx = (c.idx + 1) % c.buf.length;
            acc += out;
          }
          const aps = this.allpasses[ch];
          let apOut = acc;
          for (let k = 0; k < aps.length; k++) {
            const ap = aps[k];
            const bOut = ap.buf[ap.idx];
            ap.buf[ap.idx] = apOut + bOut * 0.5;
            apOut = bOut - apOut * 0.5;
            ap.idx = (ap.idx + 1) % ap.buf.length;
          }
          return apOut * 0.35;
        };

        const wL = runVerb(0, preL);
        const wR = runVerb(1, preR);
        const dry = 1 - rev.mix;
        l = l * dry + wL * rev.mix;
        r = r * dry + wR * rev.mix;
      }

      // 9. Brickwall Limiter
      if (lim && lim.enabled) {
        const pk = Math.max(Math.abs(l), Math.abs(r));
        const target = pk > limCeiling ? limCeiling / pk : 1;
        this.limGain = target < this.limGain ? target : limRel * this.limGain + (1 - limRel) * target;
        l = Math.max(-limCeiling, Math.min(limCeiling, l * this.limGain));
        r = Math.max(-limCeiling, Math.min(limCeiling, r * this.limGain));
      }

      outL[i] = l;
      if (output.length > 1) outR[i] = r;
    }

    return true;
  }
}

registerProcessor('dsp-rack-processor', DspRackProcessor);
