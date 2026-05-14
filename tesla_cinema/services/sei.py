from __future__ import annotations

import math
import struct
from pathlib import Path

from tesla_cinema.domain.models import APStatus, GearState, SEIDataPoint


class RawSEIMessage(dict):
    pass


def extract_sei_from_file(path: Path) -> list[RawSEIMessage]:
    data = path.read_bytes()
    mdat = _find_mdat_box(data)
    if not mdat:
        return []

    offset, size = mdat
    cursor = offset
    end = offset + size
    messages: list[RawSEIMessage] = []

    while cursor + 4 <= end and cursor + 4 <= len(data):
        nal_size = int.from_bytes(data[cursor : cursor + 4], "big", signed=False)
        cursor += 4
        if nal_size < 2 or cursor + nal_size > len(data):
            cursor += max(nal_size, 0)
            continue
        nal = data[cursor : cursor + nal_size]
        nal_type = nal[0] & 0x1F
        payload_type = nal[1] if len(nal) > 1 else -1
        if nal_type == 6 and payload_type == 5:
            decoded = _decode_sei(nal)
            if decoded:
                messages.append(decoded)
        cursor += nal_size
    return messages


def convert_to_data_points(
    messages: list[RawSEIMessage],
    segment_start_seconds: float,
    frame_duration_ms: float = 33.333,
) -> list[SEIDataPoint]:
    gear_map: dict[int, GearState] = {0: "P", 1: "D", 2: "R", 3: "N"}
    ap_map: dict[int, APStatus] = {0: "OFF", 1: "FSD", 2: "AP", 3: "STANDBY"}
    return [
        SEIDataPoint(
            offset_seconds=segment_start_seconds + (index * frame_duration_ms) / 1000.0,
            speed_kph=float(msg.get("vehicleSpeedMps", 0.0)) * 3.6,
            gear=gear_map.get(int(msg.get("gearState", -1)), "UNKNOWN"),
            steering_angle_deg=float(msg.get("steeringWheelAngle", 0.0)) * (180.0 / math.pi),
            brake_pct=100.0 if bool(msg.get("brakeApplied", False)) else 0.0,
            throttle_pct=float(msg.get("acceleratorPedalPosition", 0.0)) * 100.0,
            ap_status=ap_map.get(int(msg.get("autopilotState", -1)), "UNKNOWN"),
            latitude=float(msg.get("latitudeDeg", 0.0)),
            longitude=float(msg.get("longitudeDeg", 0.0)),
        )
        for index, msg in enumerate(messages)
    ]


def _find_mdat_box(data: bytes) -> tuple[int, int] | None:
    pos = 0
    total = len(data)
    while pos + 8 <= total:
        size = int.from_bytes(data[pos : pos + 4], "big", signed=False)
        box_type = data[pos + 4 : pos + 8].decode("ascii", errors="ignore")
        header_size = 8
        if size == 1 and pos + 16 <= total:
            size = int.from_bytes(data[pos + 8 : pos + 16], "big", signed=False)
            header_size = 16
        elif size == 0:
            size = total - pos
        if box_type == "mdat":
            return pos + header_size, size - header_size
        if size <= 0:
            break
        pos += size
    return None


def _decode_sei(nal: bytes) -> RawSEIMessage | None:
    if len(nal) < 4:
        return None
    index = 3
    while index < len(nal) and nal[index] == 0x42:
        index += 1
    if index <= 3 or index + 1 >= len(nal) or nal[index] != 0x69:
        return None
    payload = _strip_emulation_bytes(nal[index + 1 : len(nal) - 1])
    try:
        return _decode_protobuf(payload)
    except Exception:
        return None


def _strip_emulation_bytes(data: bytes) -> bytes:
    out = bytearray()
    zeros = 0
    for byte in data:
        if zeros >= 2 and byte == 0x03:
            zeros = 0
            continue
        out.append(byte)
        zeros = zeros + 1 if byte == 0 else 0
    return bytes(out)


def _decode_protobuf(data: bytes) -> RawSEIMessage:
    message: RawSEIMessage = RawSEIMessage()
    pos = 0
    length = len(data)
    while pos < length:
        tag = _read_varint(data, pos)
        if tag is None:
            break
        tag_value, pos = tag
        field_number = tag_value >> 3
        wire_type = tag_value & 0x07
        if field_number in {1, 2, 3, 7, 8, 9, 10} and wire_type == 0:
            value = _read_varint(data, pos)
            if value is None:
                break
            decoded, pos = value
            key = {
                1: "version",
                2: "gearState",
                3: "frameSeqNo",
                7: "blinkerOnLeft",
                8: "blinkerOnRight",
                9: "brakeApplied",
                10: "autopilotState",
            }[field_number]
            message[key] = bool(decoded) if field_number in {7, 8, 9} else decoded
        elif field_number in {4, 5, 6} and wire_type == 5 and pos + 4 <= length:
            decoded = struct.unpack_from("<f", data, pos)[0]
            key = {4: "vehicleSpeedMps", 5: "acceleratorPedalPosition", 6: "steeringWheelAngle"}[field_number]
            message[key] = decoded
            pos += 4
        elif field_number in {11, 12, 13, 14, 15, 16} and wire_type == 1 and pos + 8 <= length:
            decoded = struct.unpack_from("<d", data, pos)[0]
            key = {
                11: "latitudeDeg",
                12: "longitudeDeg",
                13: "headingDeg",
                14: "linearAccelerationX",
                15: "linearAccelerationY",
                16: "linearAccelerationZ",
            }[field_number]
            message[key] = decoded
            pos += 8
        else:
            pos = _skip_wire_value(data, pos, wire_type)
            if pos < 0:
                break
    return message


def _skip_wire_value(data: bytes, pos: int, wire_type: int) -> int:
    if wire_type == 0:
        value = _read_varint(data, pos)
        return value[1] if value else -1
    if wire_type == 1:
        return pos + 8
    if wire_type == 2:
        value = _read_varint(data, pos)
        if value is None:
            return -1
        length, next_pos = value
        return next_pos + length
    if wire_type == 5:
        return pos + 4
    return -1


def _read_varint(data: bytes, pos: int) -> tuple[int, int] | None:
    result = 0
    shift = 0
    while pos < len(data):
        byte = data[pos]
        pos += 1
        result |= (byte & 0x7F) << shift
        if not (byte & 0x80):
            return result, pos
        shift += 7
        if shift > 49:
            return None
    return None
