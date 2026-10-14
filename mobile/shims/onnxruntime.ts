// `onnxruntime-node` for the phone server, over ONNX Runtime for Android
// (the GirovoModel plugin, android/app/src/main/java/…/ModelPlugin.kt).
//
// lib/category-model.ts tokenizes, builds the int64 tensors, runs the session
// and mean-pools the last hidden state itself. Sending that hidden state
// across the WebView bridge would be [batch × tokens × 768] floats per batch,
// so the plugin pools natively (the sum over the masked tokens, which is all
// the pooling uses before it normalises) and answers [batch × 768]. The tensor
// this hands back keeps the shape the pooling loop walks — [batch, tokens,
// dim] — with each row's sum at its first token and zeros after it, so the
// loop arrives at exactly the vector the desktop computes.

import { GirovoModel } from '../native';

type TensorType = 'int64' | 'float32';

export class Tensor {
  readonly type: TensorType;
  readonly data: BigInt64Array | Float32Array;
  readonly dims: readonly number[];
  constructor(type: TensorType, data: BigInt64Array | Float32Array, dims: readonly number[]) {
    this.type = type;
    this.data = data;
    this.dims = dims;
  }
}

function rows(t: Tensor | undefined): number[][] {
  if (!t) return [];
  const [n, len] = t.dims;
  const data = t.data as BigInt64Array;
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < len; j++) row.push(Number(data[i * len + j]));
    out.push(row);
  }
  return out;
}

function decodeFloats(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export class InferenceSession {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  private constructor(inputNames: readonly string[], outputNames: readonly string[]) {
    this.inputNames = inputNames;
    this.outputNames = outputNames;
  }

  /** `path` is the virtual one (/model/…); the plugin knows where the file really is. */
  static async create(path: string, options?: { intraOpNumThreads?: number }): Promise<InferenceSession> {
    const name = path.split('/').pop() ?? path;
    const { inputNames, outputNames } = await GirovoModel.load({ file: name, threads: options?.intraOpNumThreads ?? 2 });
    return new InferenceSession(inputNames, outputNames);
  }

  async run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>> {
    const ids = feeds.input_ids;
    const [n, len] = ids.dims;
    const { dim, pooled } = await GirovoModel.embed({ ids: rows(ids), mask: rows(feeds.attention_mask) });
    const sums = decodeFloats(pooled);
    const hidden = new Float32Array(n * len * dim);
    for (let i = 0; i < n; i++) hidden.set(sums.subarray(i * dim, (i + 1) * dim), i * len * dim);
    return { [this.outputNames[0]]: new Tensor('float32', hidden, [n, len, dim]) };
  }

  async release(): Promise<void> {
    await GirovoModel.release();
  }
}

export default { InferenceSession, Tensor };
