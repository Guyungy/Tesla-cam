import type { APStatus, GearState, SEIDataPoint } from './types';

/** Raw parsed SEI message matching the Tesla protobuf schema */
export interface RawSEIMessage {
  version?: number;
  gearState?: number; // 0=Park, 1=Drive, 2=Reverse, 3=Neutral
  frameSeqNo?: number;
  vehicleSpeedMps?: number;
  acceleratorPedalPosition?: number; // percent, 0-100 (see toThrottlePct)
  steeringWheelAngle?: number; // degrees (see toSteeringDeg)
  blinkerOnLeft?: boolean;
  blinkerOnRight?: boolean;
  brakeApplied?: boolean;
  autopilotState?: number; // 0=None, 1=SelfDriving, 2=Autosteer, 3=TACC
  latitudeDeg?: number;
  longitudeDeg?: number;
  headingDeg?: number;
  linearAccelerationX?: number;
  linearAccelerationY?: number;
  linearAccelerationZ?: number;
}

/**
 * Extract all SEI metadata from a Tesla dashcam MP4 file.
 * Aligned with Tesla's official dashcam-mp4.js implementation.
 *
 * Prefer streaming box walk + chunked mdat reads for large files; fall back to
 * full ArrayBuffer only when progressive reads fail.
 */
export async function extractSEIFromFile(file: File): Promise<RawSEIMessage[]> {
  try {
    const streamed = await extractSEIFromFileStreaming(file);
    if (streamed !== null) return streamed;
  } catch (e) {
    console.warn(
      '[SEI] Streaming extract failed, falling back to full read:',
      e,
    );
  }
  return extractSEIFromFullBuffer(file);
}

async function extractSEIFromFullBuffer(file: File): Promise<RawSEIMessage[]> {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  const data = new Uint8Array(buffer);

  const mdat = findMdatBox(view, data.length);
  if (!mdat) return [];

  return parseMdatNals(data, mdat.offset, mdat.offset + mdat.size);
}

/**
 * Progressive File.slice walk: locate mdat without loading the whole MP4,
 * then scan mdat in ~4MB chunks (handles NAL spanning chunk boundaries).
 * Returns null if mdat cannot be located.
 */
async function extractSEIFromFileStreaming(
  file: File,
): Promise<RawSEIMessage[] | null> {
  const fileSize = file.size;
  if (fileSize <= 0) return [];

  let pos = 0;
  let mdatOffset = -1;
  let mdatSize = 0;

  while (pos + 8 <= fileSize) {
    const headerBuf = await file
      .slice(pos, Math.min(pos + 16, fileSize))
      .arrayBuffer();
    if (headerBuf.byteLength < 8) break;
    const view = new DataView(headerBuf);
    let size = view.getUint32(0);
    const type = String.fromCharCode(
      view.getUint8(4),
      view.getUint8(5),
      view.getUint8(6),
      view.getUint8(7),
    );
    let headerSize = 8;
    if (size === 1) {
      if (headerBuf.byteLength < 16) break;
      const high = view.getUint32(8);
      const low = view.getUint32(12);
      size = Number((BigInt(high) << 32n) | BigInt(low));
      headerSize = 16;
    } else if (size === 0) {
      size = fileSize - pos;
    }
    if (size < 8) break;

    if (type === 'mdat') {
      mdatOffset = pos + headerSize;
      mdatSize = size - headerSize;
      break;
    }
    pos += size;
  }

  if (mdatOffset < 0 || mdatSize <= 0) return null;

  // For modest mdat (≤48MB) one slice is simpler and still far cheaper than full-file
  // when moov is at the end. Larger files use chunked scan.
  const FULL_SLICE_LIMIT = 48 * 1024 * 1024;
  if (mdatSize <= FULL_SLICE_LIMIT) {
    const buf = await file
      .slice(mdatOffset, mdatOffset + mdatSize)
      .arrayBuffer();
    const data = new Uint8Array(buf);
    return parseMdatNals(data, 0, data.length);
  }

  return parseMdatNalsChunked(file, mdatOffset, mdatSize);
}

function parseMdatNals(
  data: Uint8Array,
  start: number,
  end: number,
): RawSEIMessage[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const messages: RawSEIMessage[] = [];
  let cursor = start;

  while (cursor + 4 <= end) {
    const nalSize = view.getUint32(cursor);
    cursor += 4;

    if (
      nalSize < 2 ||
      cursor + nalSize > end ||
      cursor + nalSize > data.length
    ) {
      cursor += Math.max(nalSize, 0);
      continue;
    }

    const nalType = data[cursor] & 0x1f;
    const payloadType = data[cursor + 1];

    if (nalType === 6 && payloadType === 5) {
      const nalData = data.subarray(cursor, cursor + nalSize);
      const decoded = decodeSei(nalData);
      if (decoded) messages.push(decoded);
    }

    cursor += nalSize;
  }

  return messages;
}

async function parseMdatNalsChunked(
  file: File,
  mdatOffset: number,
  mdatSize: number,
): Promise<RawSEIMessage[]> {
  const CHUNK = 4 * 1024 * 1024;
  const messages: RawSEIMessage[] = [];
  let filePos = mdatOffset;
  const mdatEnd = mdatOffset + mdatSize;
  let carry = new Uint8Array(0);

  while (filePos < mdatEnd || carry.length > 0) {
    if (carry.length < 4 && filePos < mdatEnd) {
      const take = Math.min(CHUNK, mdatEnd - filePos);
      const next = new Uint8Array(
        await file.slice(filePos, filePos + take).arrayBuffer(),
      );
      filePos += take;
      const merged = new Uint8Array(carry.length + next.length);
      merged.set(carry);
      merged.set(next, carry.length);
      carry = merged;
    }

    if (carry.length < 4) break;

    const view = new DataView(carry.buffer, carry.byteOffset, carry.byteLength);
    const nalSize = view.getUint32(0);
    if (nalSize < 2 || nalSize > mdatSize) {
      // Desync — abort chunked parse
      break;
    }

    const totalNeed = 4 + nalSize;
    if (carry.length < totalNeed) {
      if (filePos >= mdatEnd) break;
      const take = Math.min(CHUNK, mdatEnd - filePos);
      const next = new Uint8Array(
        await file.slice(filePos, filePos + take).arrayBuffer(),
      );
      filePos += take;
      const merged = new Uint8Array(carry.length + next.length);
      merged.set(carry);
      merged.set(next, carry.length);
      carry = merged;
      continue;
    }

    const nal = carry.subarray(4, totalNeed);
    const nalType = nal[0] & 0x1f;
    const payloadType = nal[1];
    if (nalType === 6 && payloadType === 5) {
      const decoded = decodeSei(nal);
      if (decoded) messages.push(decoded);
    }
    carry = carry.subarray(totalNeed);
  }

  return messages;
}

/** TeslaCam H.264 is typically ~36 fps; SEI is roughly one sample per coded frame. */
const DEFAULT_SEI_FPS = 36;

/**
 * Convert raw SEI messages to our app's SEIDataPoint format.
 *
 * Timing notes:
 * - Do NOT stretch samples evenly across the full segment duration. That maps early
 *   driving samples onto the parked tail and shows e.g. 70 km/h while stopped.
 * - Prefer monotonic `frameSeqNo` when present; otherwise index / fps.
 * - Clamp offsets into the segment window.
 */
export function convertToDataPoints(
  messages: RawSEIMessage[],
  segmentStartSeconds: number,
  segmentDurationSeconds: number = 0,
  fps: number = DEFAULT_SEI_FPS,
): SEIDataPoint[] {
  if (messages.length === 0) return [];

  const gearMap: Record<number, GearState> = {
    0: 'P',
    1: 'D',
    2: 'R',
    3: 'N',
  };

  const apMap: Record<number, APStatus> = {
    0: 'OFF',
    1: 'FSD',
    2: 'AP',
    3: 'STANDBY',
  };

  let safeFps = fps > 1 && Number.isFinite(fps) ? fps : DEFAULT_SEI_FPS;
  const seqs = messages.map((m) => m.frameSeqNo);
  const allHaveSeq = seqs.every(
    (s) => typeof s === 'number' && Number.isFinite(s),
  );
  const minSeq = allHaveSeq ? Math.min(...(seqs as number[])) : 0;

  // Estimate the real frame rate from the data itself when possible: SEI is
  // one sample per coded frame, so (span of samples) / duration ≈ fps.
  // A fixed 36 fps assumption drifts on clips recorded at other rates —
  // telemetry would end early (fake stopped tail) or get clipped.
  if (segmentDurationSeconds > 1) {
    const span = allHaveSeq
      ? Math.max(...(seqs as number[])) - minSeq
      : messages.length - 1;
    const estFps = span / segmentDurationSeconds;
    if (Number.isFinite(estFps) && estFps >= 5 && estFps <= 120) {
      safeFps = estFps;
    }
  }

  const rawOffsets = messages.map((msg, index) => {
    if (allHaveSeq) {
      return (
        segmentStartSeconds + ((msg.frameSeqNo as number) - minSeq) / safeFps
      );
    }
    return segmentStartSeconds + index / safeFps;
  });

  // If timestamps run past the segment, scale into [start, start+duration]
  // instead of inventing fake parking-time samples from early driving data.
  let offsets = rawOffsets;
  if (segmentDurationSeconds > 0) {
    const maxOff = Math.max(...rawOffsets);
    const end = segmentStartSeconds + segmentDurationSeconds;
    if (maxOff > end + 0.05 && maxOff > segmentStartSeconds) {
      const span = maxOff - segmentStartSeconds;
      offsets = rawOffsets.map(
        (o) =>
          segmentStartSeconds +
          ((o - segmentStartSeconds) / span) * segmentDurationSeconds,
      );
    }
  }

  return messages.map((msg, index) => {
    // Protobuf omits fields that equal the default, so an absent gear/AP field
    // means 0 — Park / no autopilot — not "unknown". Verified on real footage:
    // every sample missing gear_state also reports exactly 0 speed and 0 pedal,
    // in contiguous blocks at the head/tail of a clip (i.e. parked).
    const gear = gearMap[msg.gearState ?? 0] || 'UNKNOWN';
    let speedKph = toSpeedKph(msg.vehicleSpeedMps);

    // Park + near-zero motion: treat as stopped (avoids tiny float noise)
    if (gear === 'P' && speedKph < 1.5) {
      speedKph = 0;
    }

    const offsetSeconds =
      segmentDurationSeconds > 0
        ? clamp(
            offsets[index],
            segmentStartSeconds,
            segmentStartSeconds + segmentDurationSeconds,
          )
        : offsets[index];

    return {
      offsetSeconds,
      speedKph,
      gear,
      steeringAngleDeg: toSteeringDeg(msg.steeringWheelAngle),
      brakePct: msg.brakeApplied ? 100 : 0,
      throttlePct: toThrottlePct(msg.acceleratorPedalPosition),
      apStatus: apMap[msg.autopilotState ?? 0] || 'UNKNOWN',
      latitude: msg.latitudeDeg || 0,
      longitude: msg.longitudeDeg || 0,
    };
  });
}

/**
 * Tesla schema documents field 4 as m/s. Guard against corrupt / alternate units:
 * values that already look like km/h (> ~90 as "m/s" ⇒ >324 km/h) are used as-is.
 */
function toSpeedKph(raw: number | undefined): number {
  const v = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  if (v < 0) return 0;
  // Already km/h-ish and would be absurd if treated as m/s
  if (v > 90) return Math.min(v, 300);
  const asKph = v * 3.6;
  return Math.min(asKph, 300);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Field 6 carries the steering wheel angle in DEGREES, despite the schema note
 * calling it radians. Measured across 24k samples of real footage: median
 * |14.6|, p99 |384.7|, max |389.3| — a clean ±~390° envelope matching a wheel
 * that turns a little over one full rotation each way. Read as radians those
 * same samples would mean 62 full turns, and the UI gauge showed >22,000°.
 * Clamped to ±900° (well past any production steering lock) as a backstop.
 */
function toSteeringDeg(raw: number | undefined): number {
  const v = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  return clamp(v, -900, 900);
}

/**
 * Field 5 carries accelerator pedal position as a PERCENT (0–100), not the
 * 0.0–1.0 fraction the schema note implies: real samples run 0–38 with a
 * median of 6.8. Multiplying by 100 pinned the throttle bar at 100% for any
 * pedal press above 1%.
 */
function toThrottlePct(raw: number | undefined): number {
  const v = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  return clamp(v, 0, 100);
}

/**
 * Build CSV string from raw SEI messages for export.
 */
export function buildSEICsv(messages: RawSEIMessage[]): string {
  const header = [
    'frame_seq',
    'speed_mps',
    'gear',
    'steering_rad',
    'accel_pedal',
    'brake',
    'ap_state',
    'lat',
    'lon',
    'heading',
    'accel_x',
    'accel_y',
    'accel_z',
  ].join(',');

  const lines = messages.map((m) =>
    [
      m.frameSeqNo ?? '',
      m.vehicleSpeedMps ?? '',
      m.gearState ?? '',
      m.steeringWheelAngle ?? '',
      m.acceleratorPedalPosition ?? '',
      m.brakeApplied ? 1 : 0,
      m.autopilotState ?? '',
      m.latitudeDeg ?? '',
      m.longitudeDeg ?? '',
      m.headingDeg ?? '',
      m.linearAccelerationX ?? '',
      m.linearAccelerationY ?? '',
      m.linearAccelerationZ ?? '',
    ].join(','),
  );

  return [header, ...lines].join('\n');
}

// ── Private Helpers ─────────────────────────────────────────────────

/**
 * Find mdat box using DataView (avoids signed integer overflow from bitwise ops).
 * Matches Tesla's findBox approach.
 */
function findMdatBox(
  view: DataView,
  fileSize: number,
): { offset: number; size: number } | null {
  let pos = 0;
  while (pos + 8 <= fileSize) {
    let size = view.getUint32(pos); // unsigned 32-bit
    const type = String.fromCharCode(
      view.getUint8(pos + 4),
      view.getUint8(pos + 5),
      view.getUint8(pos + 6),
      view.getUint8(pos + 7),
    );

    let headerSize = 8;
    if (size === 1) {
      // 64-bit extended size
      const high = view.getUint32(pos + 8);
      const low = view.getUint32(pos + 12);
      size = Number((BigInt(high) << 32n) | BigInt(low));
      headerSize = 16;
    } else if (size === 0) {
      size = fileSize - pos;
    }

    if (type === 'mdat') {
      return { offset: pos + headerSize, size: size - headerSize };
    }

    pos += size;
  }
  return null;
}

/**
 * Decode a SEI NAL unit to a protobuf message.
 * Matches Tesla's decodeSei exactly:
 *   - Skip first 3 bytes (NAL header + payload type + payload size)
 *   - Skip 0x42 marker bytes (must have at least one)
 *   - Check for 0x69 marker
 *   - Strip last byte (RBSP stop bit) BEFORE emulation byte removal
 *   - Remove emulation prevention bytes
 *   - Decode protobuf
 */
function decodeSei(nal: Uint8Array): RawSEIMessage | null {
  if (nal.length < 4) return null;

  let i = 3;
  while (i < nal.length && nal[i] === 0x42) i++;

  // Must have found at least one 0x42, and next byte must be 0x69
  if (i <= 3 || i + 1 >= nal.length || nal[i] !== 0x69) return null;

  try {
    // Strip last byte (RBSP stop bit), then remove emulation bytes
    const payload = nal.subarray(i + 1, nal.length - 1);
    const stripped = stripEmulationBytes(payload);
    return decodeProtobuf(stripped);
  } catch {
    return null;
  }
}

/**
 * Strip H.264 emulation prevention bytes (00 00 03 → 00 00).
 * Matches Tesla's stripEmulationBytes.
 */
function stripEmulationBytes(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let zeros = 0;
  for (const byte of data) {
    if (zeros >= 2 && byte === 0x03) {
      zeros = 0;
      continue;
    }
    out.push(byte);
    zeros = byte === 0 ? zeros + 1 : 0;
  }
  return Uint8Array.from(out);
}

/**
 * Lightweight protobuf decoder for the SeiMetadata message.
 * Handles all field types in the Tesla schema.
 */
function decodeProtobuf(data: Uint8Array): RawSEIMessage {
  const msg: RawSEIMessage = {};
  const buf =
    data.buffer.byteLength === data.length
      ? data.buffer
      : data.buffer.slice(data.byteOffset, data.byteOffset + data.length);
  const view = new DataView(buf);
  let pos = 0;

  while (pos < data.length) {
    const tag = readVarint(data, pos);
    if (!tag) break;
    pos = tag.nextPos;
    const fieldNumber = tag.value >>> 3;
    const wireType = tag.value & 0x07;

    switch (fieldNumber) {
      case 1: // version (uint32, varint)
        if (wireType === 0) {
          const v = readVarint(data, pos);
          if (v) {
            msg.version = v.value;
            pos = v.nextPos;
          }
        }
        break;
      case 2: // gear_state (enum, varint)
        if (wireType === 0) {
          const v = readVarint(data, pos);
          if (v) {
            msg.gearState = v.value;
            pos = v.nextPos;
          }
        }
        break;
      case 3: // frame_seq_no (uint64, varint)
        if (wireType === 0) {
          const v = readVarint(data, pos);
          if (v) {
            msg.frameSeqNo = v.value;
            pos = v.nextPos;
          }
        }
        break;
      case 4: // vehicle_speed_mps (float, 32-bit)
        if (wireType === 5 && pos + 4 <= data.length) {
          msg.vehicleSpeedMps = view.getFloat32(pos, true);
          pos += 4;
        }
        break;
      case 5: // accelerator_pedal_position (float)
        if (wireType === 5 && pos + 4 <= data.length) {
          msg.acceleratorPedalPosition = view.getFloat32(pos, true);
          pos += 4;
        }
        break;
      case 6: // steering_wheel_angle (float)
        if (wireType === 5 && pos + 4 <= data.length) {
          msg.steeringWheelAngle = view.getFloat32(pos, true);
          pos += 4;
        }
        break;
      case 7: // blinker_on_left (bool, varint)
        if (wireType === 0) {
          const v = readVarint(data, pos);
          if (v) {
            msg.blinkerOnLeft = v.value !== 0;
            pos = v.nextPos;
          }
        }
        break;
      case 8: // blinker_on_right (bool, varint)
        if (wireType === 0) {
          const v = readVarint(data, pos);
          if (v) {
            msg.blinkerOnRight = v.value !== 0;
            pos = v.nextPos;
          }
        }
        break;
      case 9: // brake_applied (bool, varint)
        if (wireType === 0) {
          const v = readVarint(data, pos);
          if (v) {
            msg.brakeApplied = v.value !== 0;
            pos = v.nextPos;
          }
        }
        break;
      case 10: // autopilot_state (enum, varint)
        if (wireType === 0) {
          const v = readVarint(data, pos);
          if (v) {
            msg.autopilotState = v.value;
            pos = v.nextPos;
          }
        }
        break;
      case 11: // latitude_deg (double, 64-bit)
        if (wireType === 1 && pos + 8 <= data.length) {
          msg.latitudeDeg = view.getFloat64(pos, true);
          pos += 8;
        }
        break;
      case 12: // longitude_deg (double)
        if (wireType === 1 && pos + 8 <= data.length) {
          msg.longitudeDeg = view.getFloat64(pos, true);
          pos += 8;
        }
        break;
      case 13: // heading_deg (double)
        if (wireType === 1 && pos + 8 <= data.length) {
          msg.headingDeg = view.getFloat64(pos, true);
          pos += 8;
        }
        break;
      case 14: // linear_acceleration_x (double)
        if (wireType === 1 && pos + 8 <= data.length) {
          msg.linearAccelerationX = view.getFloat64(pos, true);
          pos += 8;
        }
        break;
      case 15: // linear_acceleration_y (double)
        if (wireType === 1 && pos + 8 <= data.length) {
          msg.linearAccelerationY = view.getFloat64(pos, true);
          pos += 8;
        }
        break;
      case 16: // linear_acceleration_z (double)
        if (wireType === 1 && pos + 8 <= data.length) {
          msg.linearAccelerationZ = view.getFloat64(pos, true);
          pos += 8;
        }
        break;
      default:
        // Skip unknown fields
        if (wireType === 0) {
          const v = readVarint(data, pos);
          if (v) pos = v.nextPos;
          else return msg;
        } else if (wireType === 1) {
          pos += 8;
        } else if (wireType === 2) {
          const v = readVarint(data, pos);
          if (v) pos = v.nextPos + v.value;
          else return msg;
        } else if (wireType === 5) {
          pos += 4;
        } else {
          return msg;
        } // Unknown wire type, stop parsing
    }
  }

  return msg;
}

function readVarint(
  data: Uint8Array,
  pos: number,
): { value: number; nextPos: number } | null {
  if (pos >= data.length) return null;
  let result = 0;
  let shift = 0;
  while (pos < data.length) {
    const byte = data[pos++];
    result += (byte & 0x7f) * Math.pow(2, shift);
    if (!(byte & 0x80)) break;
    shift += 7;
    if (shift > 49) return null; // Overflow protection
  }
  return { value: result, nextPos: pos };
}
