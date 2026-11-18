import fs from 'node:fs';
import path from 'node:path';
import * as ort from 'onnxruntime-node';

export interface OnnxModelInfo {
  name: string;
  filePath: string;
  sizeBytes: number;
}

export interface OnnxModelInspection {
  modelPath: string;
  inputNames: readonly string[];
  outputNames: readonly string[];
}

export function listOnnxModels(modelsDir: string): OnnxModelInfo[] {
  if (!fs.existsSync(modelsDir)) return [];
  return fs
    .readdirSync(modelsDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.onnx'))
    .map((e) => {
      const fp = path.join(modelsDir, e.name);
      return {
        name: e.name,
        filePath: fp,
        sizeBytes: fs.statSync(fp).size,
      };
    });
}

export function importOnnxModel(sourcePath: string, modelsDir: string): OnnxModelInfo {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`El modelo ONNX no existe: ${sourcePath}`);
  }
  fs.mkdirSync(modelsDir, { recursive: true });
  const dest = path.join(modelsDir, path.basename(sourcePath));
  fs.copyFileSync(sourcePath, dest);
  return {
    name: path.basename(dest),
    filePath: dest,
    sizeBytes: fs.statSync(dest).size,
  };
}

export async function inspectOnnxModel(modelPath: string): Promise<OnnxModelInspection> {
  const session = await ort.InferenceSession.create(modelPath);
  const info: OnnxModelInspection = {
    modelPath,
    inputNames: session.inputNames,
    outputNames: session.outputNames,
  };
  await session.release();
  return info;
}

/**
 * Executes real local ONNX Runtime inference on mono Float32 audio samples.
 * Automatically adapts between [1, N] and [1, 1, N] waveform input shapes.
 */
export async function runOnnxWaveformModel(
  modelPath: string,
  monoSamples: Float32Array
): Promise<Float32Array> {
  const session = await ort.InferenceSession.create(modelPath);
  try {
    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];
    if (!inputName || !outputName) {
      throw new Error('Modelo ONNX sin tensores de entrada/salida válidos.');
    }

    const attempts: number[][] = [
      [1, monoSamples.length],
      [1, 1, monoSamples.length],
    ];

    let lastErr: unknown = null;
    for (const dims of attempts) {
      try {
        const tensor = new ort.Tensor('float32', monoSamples, dims);
        const feeds: Record<string, ort.Tensor> = { [inputName]: tensor };
        const results = await session.run(feeds);
        const outTensor = results[outputName];
        if (outTensor && outTensor.data instanceof Float32Array) {
          return new Float32Array(outTensor.data.slice(0, monoSamples.length));
        }
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  } finally {
    await session.release();
  }
}
