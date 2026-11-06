// onnxruntime-node for the desktop runtime: the category model runs in the
// Tauri shell (src-tauri/src/model.rs, ONNX Runtime), not in the page.
// lib/category-model.ts is unchanged; this module gives it the part of ort's
// API it uses — Tensor, InferenceSession.create, run, release and the input
// and output names — with int64 and float32 tensors, the two the model needs.
//
// The weights never come into the page: create() names the file, and the
// shell opens it in its own copy of the model folder (desktop/server/model.ts
// put only the small files into the page's tree).

import { Buffer } from 'buffer';
import { invoke } from '../shell';

type TensorType = 'int64' | 'float32';
type TensorData = BigInt64Array | Float32Array;

export class Tensor {
  readonly dims: readonly number[];

  constructor(
    public readonly type: TensorType,
    public readonly data: TensorData,
    dims?: readonly number[],
  ) {
    const kind = type === 'int64' ? BigInt64Array : type === 'float32' ? Float32Array : null;
    if (!kind) throw new TypeError(`Unsupported tensor type: ${type}`);
    if (!(data instanceof kind)) throw new TypeError(`A ${type} tensor needs a ${kind.name}`);
    this.dims = dims ?? [data.length];
    if (this.dims.reduce((n, d) => n * d, 1) !== data.length) {
      throw new RangeError(`Tensor's size (${data.length}) does not match its dims (${this.dims.join('×')})`);
    }
  }
}

type SessionOptions = { executionProviders?: string[]; intraOpNumThreads?: number; interOpNumThreads?: number };
type Opened = { id: number; inputNames: string[]; outputNames: string[] };
type Described = { name: string; type: TensorType; dims: number[] };

/** The shell's answer to run(): a little-endian u32 header length, the JSON header, then each output on an 8-byte boundary. */
function unframe(frame: ArrayBuffer): Record<string, Tensor> {
  const length = new DataView(frame).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(frame, 4, length))) as Described[];
  const out: Record<string, Tensor> = {};
  let at = 4 + length;
  for (const { name, type, dims } of header) {
    at = Math.ceil(at / 8) * 8;
    const count = dims.reduce((n, d) => n * d, 1);
    const data = type === 'int64' ? new BigInt64Array(frame, at, count) : new Float32Array(frame, at, count);
    out[name] = new Tensor(type, data, dims);
    at += data.byteLength;
  }
  return out;
}

export class InferenceSession {
  private constructor(
    private readonly id: number,
    readonly inputNames: readonly string[],
    readonly outputNames: readonly string[],
  ) {}

  static async create(path: string, options: SessionOptions = {}): Promise<InferenceSession> {
    if (options.executionProviders?.some((ep) => ep !== 'cpu')) {
      throw new Error('The desktop runs the category model on the CPU only');
    }
    const file = path.split(/[\\/]/).pop() ?? '';
    const opened = await invoke<Opened>('model_open', {
      file,
      intraOpNumThreads: options.intraOpNumThreads ?? null,
      interOpNumThreads: options.interOpNumThreads ?? null,
    });
    return new InferenceSession(opened.id, opened.inputNames, opened.outputNames);
  }

  async run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>> {
    const inputs = Object.entries(feeds).map(([name, t]) => ({
      name,
      type: t.type,
      dims: t.dims,
      data: Buffer.from(t.data.buffer, t.data.byteOffset, t.data.byteLength).toString('base64'),
    }));
    return unframe(await invoke<ArrayBuffer>('model_run', { id: this.id, inputs }));
  }

  async release(): Promise<void> {
    await invoke('model_release', { id: this.id });
  }
}

const ort = { Tensor, InferenceSession };
export default ort;
