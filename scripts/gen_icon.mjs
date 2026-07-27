import sharp from 'sharp';

const SIZE = 512;
const BG = '#12304f';

const R = 100; // corner radius

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <clipPath id="roundedSquare">
      <rect width="${SIZE}" height="${SIZE}" rx="${R}" ry="${R}" />
    </clipPath>
  </defs>
  <g clip-path="url(#roundedSquare)">
    <rect width="${SIZE}" height="${SIZE}" fill="${BG}" />
    <text
      x="50%" y="54%"
      text-anchor="middle"
      dominant-baseline="central"
      font-family="Arial, Helvetica, sans-serif"
      font-weight="bold"
      font-size="320"
      fill="white"
    >€</text>
  </g>
</svg>`;

await sharp(Buffer.from(svg))
  .resize(SIZE, SIZE)
  .png()
  .toFile('build/icon.png');

console.log('Wrote build/icon.png');
