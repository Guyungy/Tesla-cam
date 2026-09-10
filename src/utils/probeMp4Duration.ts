/**
 * Probe MP4 duration by parsing the moov/mvhd atom.
 * Avoids creating <video> elements (much faster for bulk clip loading).
 */

function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, false);
}

function readU64(view: DataView, offset: number): number {
  const high = view.getUint32(offset, false);
  const low = view.getUint32(offset + 4, false);
  return Number((BigInt(high) << 32n) | BigInt(low));
}

function mvhdDuration(moov: ArrayBuffer): number | null {
  const view = new DataView(moov);
  let pos = 0;
  const total = moov.byteLength;

  while (pos + 8 <= total) {
    let size = readU32(view, pos);
    const type = String.fromCharCode(
      view.getUint8(pos + 4),
      view.getUint8(pos + 5),
      view.getUint8(pos + 6),
      view.getUint8(pos + 7),
    );
    let header = 8;
    if (size === 1 && pos + 16 <= total) {
      size = readU64(view, pos + 8);
      header = 16;
    } else if (size === 0) {
      size = total - pos;
    }
    if (size < 8) break;

    if (type === 'mvhd') {
      const bodyOff = pos + header;
      if (bodyOff + 1 > total) return null;
      const version = view.getUint8(bodyOff);
      let timescale: number;
      let duration: number;
      if (version === 1) {
        if (bodyOff + 32 > total) return null;
        timescale = readU32(view, bodyOff + 20);
        duration = readU64(view, bodyOff + 24);
      } else {
        if (bodyOff + 20 > total) return null;
        timescale = readU32(view, bodyOff + 12);
        duration = readU32(view, bodyOff + 16);
      }
      return timescale > 0 ? duration / timescale : null;
    }

    pos += size;
  }
  return null;
}

/**
 * Walk top-level boxes using progressive File.slice reads (does not load whole file).
 */
export async function probeMp4DurationFromFile(file: File): Promise<number> {
  try {
    const fileSize = file.size;
    let pos = 0;
    while (pos + 8 <= fileSize) {
      const headerBuf = await file
        .slice(pos, Math.min(pos + 16, fileSize))
        .arrayBuffer();
      if (headerBuf.byteLength < 8) break;
      const view = new DataView(headerBuf);
      let size = readU32(view, 0);
      const type = String.fromCharCode(
        view.getUint8(4),
        view.getUint8(5),
        view.getUint8(6),
        view.getUint8(7),
      );
      let header = 8;
      if (size === 1) {
        if (headerBuf.byteLength < 16) break;
        size = readU64(view, 8);
        header = 16;
      } else if (size === 0) {
        size = fileSize - pos;
      }
      if (size < 8) break;

      if (type === 'moov') {
        // Cap moov read — Tesla dashcam moov is typically well under 256KB
        const moovSize = Math.min(size - header, 512 * 1024);
        const moov = await file
          .slice(pos + header, pos + header + moovSize)
          .arrayBuffer();
        const dur = mvhdDuration(moov);
        if (dur != null && Number.isFinite(dur) && dur > 0) return dur;
        break;
      }

      pos += size;
    }
  } catch {
    /* fall through */
  }
  return 0;
}

/**
 * Probe duration from a browser/object URL via lightweight <video> metadata load.
 * Used as fallback when box parsing fails.
 */
export function probeDurationFromUrl(
  url: string,
  timeoutMs = 8000,
): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.src = url;
    let settled = false;
    const done = (value: number) => {
      if (settled) return;
      settled = true;
      video.removeAttribute('src');
      video.load();
      resolve(value);
    };
    video.addEventListener('loadedmetadata', () => done(video.duration || 0));
    video.addEventListener('error', () => done(0));
    setTimeout(() => done(0), timeoutMs);
  });
}
