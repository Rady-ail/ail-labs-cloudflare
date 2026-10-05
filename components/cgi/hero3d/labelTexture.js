import { CanvasTexture, SRGBColorSpace } from 'three';

// Label kertas ivory dengan teks "AIL LABS". Digambar ulang setelah font web siap.
export function createLabelTexture(anisotropy) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 672;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = anisotropy;

  const draw = () => {
    const g = canvas.getContext('2d');
    const paper = g.createLinearGradient(0, 0, 0, canvas.height);
    paper.addColorStop(0, '#F8F3E7');
    paper.addColorStop(1, '#EADFC8');
    g.fillStyle = paper;
    g.fillRect(0, 0, canvas.width, canvas.height);

    g.strokeStyle = '#B8954F';
    g.lineWidth = 5;
    g.strokeRect(40, 40, 944, 592);
    g.lineWidth = 1.5;
    g.strokeRect(58, 58, 908, 556);

    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#153237';
    g.font = '600 156px Fraunces, Georgia, serif';
    g.fillText('AIL LABS', 512, 290);

    g.beginPath();
    g.moveTo(372, 392);
    g.lineTo(652, 392);
    g.strokeStyle = '#B8954F';
    g.lineWidth = 2.5;
    g.stroke();

    g.fillStyle = '#8C6F35';
    g.font = '600 36px Montserrat, system-ui, sans-serif';
    if ('letterSpacing' in g) g.letterSpacing = '10px';
    g.fillText('AESTHETIC SERUM', 517, 460);
    texture.needsUpdate = true;
  };

  draw();
  if (document.fonts && document.fonts.load) {
    Promise.all([
      document.fonts.load('600 156px Fraunces'),
      document.fonts.load('600 36px Montserrat'),
    ]).then(draw, () => {});
  }
  return texture;
}

// Gradasi radial lembut (latar studio & halo champagne).
export function createRadialTexture(stops, size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [offset, color] of stops) grad.addColorStop(offset, color);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
