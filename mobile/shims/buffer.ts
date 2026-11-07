// Node's Buffer for the in-page server (Android and the desktop window): the
// `buffer` package with what it lacks from Node, so server code written for
// Node runs unchanged.
//
// buffer 6.0.3 predates Node's 'base64url' encoding and throws "Unknown
// encoding: base64url", which kept sync codes from being made or read
// (lib/sync.ts). Its base64 decoder already reads the URL-safe alphabet and
// missing padding, so reading base64url is reading base64; writing swaps the
// two characters and drops the padding, as Node does.
import { Buffer } from 'buffer';

const isUrl = (encoding: unknown) => typeof encoding === 'string' && encoding.toLowerCase() === 'base64url';
const asBase64 = (args: unknown[]) => args.map((arg) => (isUrl(arg) ? 'base64' : arg));
const urlSafe = (base64: string) => base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Patched once on the package's own class, so a module importing 'buffer'
// directly gets the same Buffer.
if (!Buffer.isEncoding('base64url')) {
  const B = Buffer as any;
  const proto = Buffer.prototype as any;

  const isEncoding = B.isEncoding;
  B.isEncoding = (encoding: unknown) => isUrl(encoding) || isEncoding(encoding);

  for (const name of ['from', 'alloc', 'byteLength'] as const) {
    const original = B[name];
    B[name] = (...args: unknown[]) => original.apply(Buffer, asBase64(args));
  }

  for (const name of ['write', 'fill', 'includes', 'indexOf', 'lastIndexOf'] as const) {
    const original = proto[name];
    proto[name] = function (this: Buffer, ...args: unknown[]) {
      return original.apply(this, asBase64(args));
    };
  }

  const toString = proto.toString;
  proto.toString = function (this: Buffer, encoding?: string, start?: number, end?: number) {
    return isUrl(encoding) ? urlSafe(toString.call(this, 'base64', start, end)) : toString.call(this, encoding, start, end);
  };
}

export { Buffer };
