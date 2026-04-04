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
 * Returns raw messages in frame order.
 */
export async function extractSEIFromFile(file: File): Promise<RawSEIMessage[]> {
  const buffer = await file.arrayBuffer();
  const data = new Uint8Array(buffer);
  
  const mdat = findMdatBox(data);
  if (!mdat) return [];

  const messages: RawSEIMessage[] = [];
  let pos = 0;
  
  while (pos + 4 <= mdat.length) {
    const nalLength = (mdat[pos] << 24) | (mdat[pos + 1] << 16) | (mdat[pos + 2] << 8) | mdat[pos + 3];
    pos += 4;
    
    if (pos + nalLength > mdat.length) break;
    
    const nalType = mdat[pos] & 0x1F;
    if (nalType === 6) { // SEI
      const nalData = mdat.subarray(pos, pos + nalLength);
      const decoded = decodeSei(nalData);
      if (decoded) {
        messages.push(decoded);
      }
    }
    
    pos += nalLength;
  }
  
  return messages;
}

/**
 * Convert raw SEI messages to our app's SEIDataPoint format.
 */
export function convertToDataPoints(
  messages: RawSEIMessage[],
  segmentStartSeconds: number,
  frameDurationMs: number = 33.333 // Default to ~30fps
): SEIDataPoint[] {
  return messages.map((msg, index) => {
    const offsetSeconds = segmentStartSeconds + (index * frameDurationMs) / 1000;
    
    const gearMap: Record<number, GearState> = {
      0: 'P',
      1: 'D',
      2: 'R',
      3: 'N'
    };
    
    const apMap: Record<number, APStatus> = {
      0: 'OFF',
      1: 'FSD',
      2: 'AP',
      3: 'STANDBY'
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
      longitude: msg.longitudeDeg || 0
    };
  });
}

/**
 * Build CSV string from raw SEI messages for export.
 */
export function buildSEICsv(messages: RawSEIMessage[]): string {
  const header = [
    'frame_seq', 'speed_mps', 'gear', 'steering_rad', 'accel_pedal', 'brake', 
    'ap_state', 'lat', 'lon', 'heading', 'accel_x', 'accel_y', 'accel_z'
  ].join(',');
  
  const lines = messages.map(m => [
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
    m.linearAccelerationZ ?? ''
  ].join(','));
  
  return [header, ...lines].join('\n');
}

// ── Private Helper Functions ──────────────────────────────────────────

function findMdatBox(data: Uint8Array): Uint8Array | null {
  let pos = 0;
  while (pos + 8 <= data.length) {
    const sizeVal = (data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3];
    const type = String.fromCharCode(data[pos + 4], data[pos + 5], data[pos + 6], data[pos + 7]);
    
    let headerSize = 8;
    let size = sizeVal;
    if (sizeVal === 1) {
      // 64-bit size
      size = Number(new DataView(data.buffer, data.byteOffset + pos + 8, 8).getBigUint64(0));
      headerSize = 16;
    }
    
    if (type === 'mdat') {
      const end = size === 0 ? data.length : pos + size;
      return data.subarray(pos + headerSize, end);
    }
    
    if (sizeVal === 0) break; // Box extends to end of file
    pos += size;
  }
  return null;
}

function decodeSei(nalData: Uint8Array): RawSEIMessage | null {
  // Skip first 3 bytes (NAL header + payload type + size)
  // Instruction: "skip first 3 bytes, then skip marker bytes (0x42), check for 0x69 marker, then decode protobuf from rest"
  let pos = 3;
  while (pos < nalData.length && nalData[pos] === 0x42) {
    pos++;
  }
  
  if (pos >= nalData.length || nalData[pos] !== 0x69) {
    return null;
  }
  pos++; // skip 0x69
  
  // Strip emulation prevention bytes (00 00 03 -> 00 00)
  // Tesla says: "decode protobuf from remaining bytes (minus last RBSP stop byte)"
  // Usually the last byte is 0x80 (RBSP stop bit) if it's not byte-aligned, but SEI might have it.
  let rawProtobuf = nalData.slice(pos);
  if (rawProtobuf[rawProtobuf.length - 1] === 0x80) {
    rawProtobuf = rawProtobuf.slice(0, -1);
  }
  
  const stripped = stripEmulationPreventionBytes(rawProtobuf);
  return decodeProtobuf(stripped);
}

function stripEmulationPreventionBytes(buffer: Uint8Array): Uint8Array {
  const result = new Uint8Array(buffer.length);
  let j = 0;
  for (let i = 0; i < buffer.length; i++) {
    if (i >= 2 && buffer[i] === 0x03 && buffer[i - 1] === 0x00 && buffer[i - 2] === 0x00) {
      continue;
    }
    result[j++] = buffer[i];
  }
  return result.slice(0, j);
}

function decodeProtobuf(data: Uint8Array): RawSEIMessage {
  const msg: RawSEIMessage = {};
  let pos = 0;
  const view = new DataView(data.buffer, data.byteOffset);

  while (pos < data.length) {
    const tag = readVarint(data, pos);
    pos = tag.nextPos;
    const fieldNumber = tag.value >> 3;
    const wireType = tag.value & 0x07;

    switch (fieldNumber) {
      case 1: // version (uint32)
        if (wireType === 0) {
          const v = readVarint(data, pos);
          msg.version = v.value;
          pos = v.nextPos;
        } break;
      case 2: // gear_state (enum)
        if (wireType === 0) {
          const v = readVarint(data, pos);
          msg.gearState = v.value;
          pos = v.nextPos;
        } break;
      case 3: // frame_seq_no (uint64)
        if (wireType === 0) {
          const v = readVarint(data, pos);
          msg.frameSeqNo = v.value;
          pos = v.nextPos;
        } break;
      case 4: // vehicle_speed_mps (float)
        if (wireType === 5) {
          msg.vehicleSpeedMps = view.getFloat32(pos, true);
          pos += 4;
        } break;
      case 5: // accelerator_pedal_position (float)
        if (wireType === 5) {
          msg.acceleratorPedalPosition = view.getFloat32(pos, true);
          pos += 4;
        } break;
      case 6: // steering_wheel_angle (float)
        if (wireType === 5) {
          msg.steeringWheelAngle = view.getFloat32(pos, true);
          pos += 4;
        } break;
      case 7: // blinker_on_left (bool)
        if (wireType === 0) {
          const v = readVarint(data, pos);
          msg.blinkerOnLeft = v.value !== 0;
          pos = v.nextPos;
        } break;
      case 8: // blinker_on_right (bool)
        if (wireType === 0) {
          const v = readVarint(data, pos);
          msg.blinkerOnRight = v.value !== 0;
          pos = v.nextPos;
        } break;
      case 9: // brake_applied (bool)
        if (wireType === 0) {
          const v = readVarint(data, pos);
          msg.brakeApplied = v.value !== 0;
          pos = v.nextPos;
        } break;
      case 10: // autopilot_state (enum)
        if (wireType === 0) {
          const v = readVarint(data, pos);
          msg.autopilotState = v.value;
          pos = v.nextPos;
        } break;
      case 11: // latitude_deg (double)
        if (wireType === 1) {
          msg.latitudeDeg = view.getFloat64(pos, true);
          pos += 8;
        } break;
      case 12: // longitude_deg (double)
        if (wireType === 1) {
          msg.longitudeDeg = view.getFloat64(pos, true);
          pos += 8;
        } break;
      case 13: // heading_deg (double)
        if (wireType === 1) {
          msg.headingDeg = view.getFloat64(pos, true);
          pos += 8;
        } break;
      case 14: // linear_acceleration_mps2_x (double)
        if (wireType === 1) {
          msg.linearAccelerationX = view.getFloat64(pos, true);
          pos += 8;
        } break;
      case 15: // linear_acceleration_mps2_y (double)
        if (wireType === 1) {
          msg.linearAccelerationY = view.getFloat64(pos, true);
          pos += 8;
        } break;
      case 16: // linear_acceleration_mps2_z (double)
        if (wireType === 1) {
          msg.linearAccelerationZ = view.getFloat64(pos, true);
          pos += 8;
        } break;
      default:
        // Skip unknown fields
        if (wireType === 0) {
          pos = readVarint(data, pos).nextPos;
        } else if (wireType === 1) {
          pos += 8;
        } else if (wireType === 2) {
          const len = readVarint(data, pos);
          pos = len.nextPos + len.value;
        } else if (wireType === 5) {
          pos += 4;
        } else {
          // Should not happen with current schema, but for robustness:
          throw new Error(`Unknown wire type ${wireType} at pos ${pos}`);
        }
    }
  }

  return msg;
}

function readVarint(data: Uint8Array, pos: number): { value: number, nextPos: number } {
  let result = 0;
  let shift = 0;
  while (pos < data.length) {
    const byte = data[pos++];
    // Use addition and multiplication to avoid 32-bit bitwise limits for numbers up to 53 bits
    result += (byte & 0x7F) * Math.pow(2, shift);
    if (!(byte & 0x80)) break;
    shift += 7;
    if (shift > 53) throw new Error("Varint too large for JS number");
  }
  return { value: result, nextPos: pos };
}
