// onnxruntime-node for the desktop runtime: the category model runs in the
// Tauri shell (Rust, ONNX Runtime), not in the page. lib/category-model.ts is
// unchanged; this module gives it the part of ort's API it uses.
//
// Until the shell's model command is in, a session cannot be made and
// lib/category-model.ts answers that the model is not available.

export class Tensor {
  constructor(
    public readonly type: string,
    public readonly data: BigInt64Array | Float32Array | Int32Array,
    public readonly dims: readonly number[],
  ) {}
}

export class InferenceSession {
  static async create(_path: string, _options?: unknown): Promise<InferenceSession> {
    throw new Error('The category model is not available in this build');
  }

  readonly inputNames: string[] = [];

  async run(_feeds: Record<string, Tensor>): Promise<Record<string, Tensor>> {
    throw new Error('The category model is not available in this build');
  }
}

const ort = { Tensor, InferenceSession };
export default ort;
