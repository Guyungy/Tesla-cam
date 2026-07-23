import type { SEIDataPoint, GearState, APStatus } from './types';

/** Raw parsed SEI message matching the Tesla protobuf schema */
export interface RawSEIMessage {
  version?: number;
  gearState?: number;        // 0=Park, 1=Drive, 2=Reverse, 3=Neutral
  frameSeqNo?: number;
  vehicleSpeedMps?: number;
  acceleratorPedalPosition?: number;  // 0.0-1.0
  steeringWheelAngle?: number;        // radians
  blinkerOnLeft?: boolean;
  blinkerOnRight?: boolean;
  brakeApplied?: boolean;
  autopilotState?: number;   // 0=None, 1=SelfDriving, 2=Autosteer, 3=TACC
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
 */
export async function extractSEIFromFile(file: File): Promise<RawSEIMessage[]> {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  const data = new Uint8Array(buffer);

  // Find mdat box
  const mdat = findMdatBox(view, data.length);
  if (!mdat) return [];

  const messages: RawSEIMessage[] = [];
  let cursor = mdat.offset;
  const end = mdat.offset + mdat.size;

  while (cursor + 4 <= end) {
    const nalSize = view.getUint32(cursor);
    cursor += 4;

    if (nalSize < 2 || cursor + nalSize > data.length) {
      cursor += Math.max(nalSize, 0);
      continue;
    }

    // Match Tesla's logic exactly:
    // NAL type 6 = SEI, AND payload type must be 5 (user data unregistered)
    const nalType = data[cursor] & 0x1F;
    const payloadType = data[cursor + 1];

    if (nalType === 6 && payloadType === 5) {
      const nalData = data.subarray(cursor, cursor + nalSize);
      const decoded = decodeSei(nalData);
      if (decoded) {
        messages.push(decoded);
      }
    }

    cursor += nalSize;
  }

  return messages;
}

/**
 * Convert raw SEI messages to our app's SEIDataPoint format.
 */
export function convertToDataPoints(
  messages: RawSEIMessage[],
  segmentStartSeconds: number,
  frameDurationMs: number = 33.333
): SEIDataPoint[] {
  return messages.map((msg, index) => {
    const offsetSeconds = segmentStartSeconds + (index * frameDurationMs) / 1000;

    const gearMap: Record<number, GearState> = {
      0: 'P', 1: 'D', 2: 'R', 3: 'N',
    };

    const apMap: Record<number, APStatus> = {
      0: 'OFF', 1: 'FSD', 2: 'AP', 3: 'STANDBY',
    };

    return {
      offsetSeconds,
      speedKph: (msg.vehicleSpeedMps || 0) * 3.6,
      gear: gearMap[msg.gearState ?? -1] || 'UNKNOWN',
      steeringAngleDeg: (msg.steeringWheelAngle || 0) * (180 / Math.PI),
      brakePct: msg.brakeApplied ? 100 : 0,
      throttlePct: (msg.acceleratorPedalPosition || 0) * 100,
      apStatus: apMap[msg.autopilotState ?? -1] || 'UNKNOWN',
      latitude: msg.latitudeDeg || 0,
      longitude: msg.longitudeDeg || 0,
    };
  });
}

/**
 * Build CSV string from raw SEI messages for export.
 */
export function buildSEICsv(messages: RawSEIMessage[]): string {
  const header = [
    'frame_seq', 'speed_mps', 'gear', 'steering_rad', 'accel_pedal', 'brake',
    'ap_state', 'lat', 'lon', 'heading', 'accel_x', 'accel_y', 'accel_z',
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
      view.getUint8(pos + 4), view.getUint8(pos + 5),
      view.getUint8(pos + 6), view.getUint8(pos + 7),
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
  const buf = data.buffer.byteLength === data.length
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
        if (wireType === 0) { const v = readVarint(data, pos); if (v) { msg.version = v.value; pos = v.nextPos; } } break;
      case 2: // gear_state (enum, varint)
        if (wireType === 0) { const v = readVarint(data, pos); if (v) { msg.gearState = v.value; pos = v.nextPos; } } break;
      case 3: // frame_seq_no (uint64, varint)
        if (wireType === 0) { const v = readVarint(data, pos); if (v) { msg.frameSeqNo = v.value; pos = v.nextPos; } } break;
      case 4: // vehicle_speed_mps (float, 32-bit)
        if (wireType === 5 && pos + 4 <= data.length) { msg.vehicleSpeedMps = view.getFloat32(pos, true); pos += 4; } break;
      case 5: // accelerator_pedal_position (float)
        if (wireType === 5 && pos + 4 <= data.length) { msg.acceleratorPedalPosition = view.getFloat32(pos, true); pos += 4; } break;
      case 6: // steering_wheel_angle (float)
        if (wireType === 5 && pos + 4 <= data.length) { msg.steeringWheelAngle = view.getFloat32(pos, true); pos += 4; } break;
      case 7: // blinker_on_left (bool, varint)
        if (wireType === 0) { const v = readVarint(data, pos); if (v) { msg.blinkerOnLeft = v.value !== 0; pos = v.nextPos; } } break;
      case 8: // blinker_on_right (bool, varint)
        if (wireType === 0) { const v = readVarint(data, pos); if (v) { msg.blinkerOnRight = v.value !== 0; pos = v.nextPos; } } break;
      case 9: // brake_applied (bool, varint)
        if (wireType === 0) { const v = readVarint(data, pos); if (v) { msg.brakeApplied = v.value !== 0; pos = v.nextPos; } } break;
      case 10: // autopilot_state (enum, varint)
        if (wireType === 0) { const v = readVarint(data, pos); if (v) { msg.autopilotState = v.value; pos = v.nextPos; } } break;
      case 11: // latitude_deg (double, 64-bit)
        if (wireType === 1 && pos + 8 <= data.length) { msg.latitudeDeg = view.getFloat64(pos, true); pos += 8; } break;
      case 12: // longitude_deg (double)
        if (wireType === 1 && pos + 8 <= data.length) { msg.longitudeDeg = view.getFloat64(pos, true); pos += 8; } break;
      case 13: // heading_deg (double)
        if (wireType === 1 && pos + 8 <= data.length) { msg.headingDeg = view.getFloat64(pos, true); pos += 8; } break;
      case 14: // linear_acceleration_x (double)
        if (wireType === 1 && pos + 8 <= data.length) { msg.linearAccelerationX = view.getFloat64(pos, true); pos += 8; } break;
      case 15: // linear_acceleration_y (double)
        if (wireType === 1 && pos + 8 <= data.length) { msg.linearAccelerationY = view.getFloat64(pos, true); pos += 8; } break;
      case 16: // linear_acceleration_z (double)
        if (wireType === 1 && pos + 8 <= data.length) { msg.linearAccelerationZ = view.getFloat64(pos, true); pos += 8; } break;
      default:
        // Skip unknown fields
        if (wireType === 0) { const v = readVarint(data, pos); if (v) pos = v.nextPos; else return msg; }
        else if (wireType === 1) { pos += 8; }
        else if (wireType === 2) { const v = readVarint(data, pos); if (v) pos = v.nextPos + v.value; else return msg; }
        else if (wireType === 5) { pos += 4; }
        else { return msg; } // Unknown wire type, stop parsing
    }
  }

  return msg;
}

function readVarint(data: Uint8Array, pos: number): { value: number; nextPos: number } | null {
  if (pos >= data.length) return null;
  let result = 0;
  let shift = 0;
  while (pos < data.length) {
    const byte = data[pos++];
    result += (byte & 0x7F) * Math.pow(2, shift);
    if (!(byte & 0x80)) break;
    shift += 7;
    if (shift > 49) return null; // Overflow protection
  }
  return { value: result, nextPos: pos };
}
