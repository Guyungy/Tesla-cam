from __future__ import annotations

import json
import mimetypes
import os
import platform
import re
import shutil
import subprocess
import tempfile
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from socketserver import ThreadingMixIn
import sys

# Import tesla cinema business logic via application use cases
from tesla_cinema.application.delete_clip import delete_clip
from tesla_cinema.application.export_clip import export_clip
from tesla_cinema.application.open_clip import open_clip
from tesla_cinema.application.scan_folder import scan_folder
from tesla_cinema.domain.models import CamClip
from tesla_cinema.services.settings import SettingsStore


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


class TeslaCinemaAPIHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Silence standard HTTP logs to keep terminal clean unless there's an error
        pass

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Range")
        self.end_headers()

    def do_GET(self):  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path == "/" or path == "/index.html":
            self._serve_static_index()
        elif path == "/api/settings":
            self._handle_get_settings()
        elif path == "/api/clips":
            self._handle_api_clips(query)
        elif path == "/api/footage":
            self._handle_api_footage(query)
        elif path == "/video/stream":
            self._handle_video_stream(query)
        else:
            self.send_error(404, "File Not Found")

    def do_POST(self):  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/export":
            self._handle_api_export()
        elif path == "/api/delete":
            self._handle_api_delete()
        else:
            self.send_error(404, "Endpoint Not Found")

    # -- Request Handlers -----------------------------------------------------

    def _serve_static_index(self):
        index_path = Path(__file__).parent / "index.html"
        if not index_path.exists():
            self.send_error(500, "Frontend index.html missing")
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        content = index_path.read_bytes()
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def _handle_get_settings(self):
        settings = SettingsStore().load()
        data = {
            "default_view": settings.default_view,
            "show_location": settings.show_location,
            "show_drive_data": settings.show_drive_data,
        }
        self._send_json(data)

    def _handle_api_clips(self, query):
        folder_list = query.get("folder")
        if not folder_list:
            self._send_json({"error": "folder parameter is required"}, status=400)
            return
        folder_path = Path(folder_list[0])
        if not folder_path.exists() or not folder_path.is_dir():
            self._send_json({"error": "Folder directory does not exist"}, status=400)
            return

        try:
            clips = scan_folder(folder_path)
            data = []
            for clip in clips:
                # Resolve friendly event name
                reason = ""
                camera = ""
                timestamp = ""
                est_lat = ""
                est_lon = ""
                if clip.event:
                    reason = clip.event.reason
                    camera = clip.event.camera
                    timestamp = clip.event.timestamp
                    est_lat = clip.event.est_lat
                    est_lon = clip.event.est_lon

                data.append({
                    "name": clip.name,
                    "type": clip.type,
                    "location": clip.location_text,
                    "has_event": clip.event is not None,
                    "event": {
                        "reason": reason,
                        "camera": camera,
                        "timestamp": timestamp,
                        "est_lat": est_lat,
                        "est_lon": est_lon,
                    }
                })
            self._send_json({"clips": data, "resolved_path": str(folder_path.absolute())})
        except Exception as e:
            self._send_json({"error": str(e)}, status=500)

    def _handle_api_footage(self, query):
        folder_list = query.get("folder")
        clip_list = query.get("clip")
        if not folder_list or not clip_list:
            self._send_json({"error": "folder and clip parameters are required"}, status=400)
            return
        folder_path = Path(folder_list[0])
        clip_name = clip_list[0]

        try:
            clips = scan_folder(folder_path)
            clip = next((c for c in clips if c.name == clip_name), None)
            if not clip:
                self._send_json({"error": f"Clip {clip_name} not found"}, status=404)
                return

            footage = open_clip(clip)
            
            # Map segments to absolute URLs
            segments_data = []
            for seg in footage.segments:
                cam_urls = {}
                for cam, path in seg.cameras.items():
                    # Return safe absolute path for the stream endpoint
                    cam_urls[cam] = f"/video/stream?path={urllib.parse.quote(str(path.absolute()))}"
                
                segments_data.append({
                    "name": seg.name,
                    "duration": seg.duration,
                    "start_seconds": seg.start_seconds,
                    "cameras": cam_urls
                })

            sei_data = []
            for pt in footage.sei_data:
                sei_data.append({
                    "offset_seconds": pt.offset_seconds,
                    "speed_kph": pt.speed_kph,
                    "gear": pt.gear,
                    "steering_angle_deg": pt.steering_angle_deg,
                    "brake_pct": pt.brake_pct,
                    "throttle_pct": pt.throttle_pct,
                    "ap_status": pt.ap_status,
                    "latitude": pt.latitude,
                    "longitude": pt.longitude
                })

            self._send_json({
                "duration": footage.duration,
                "segments": segments_data,
                "sei_data": sei_data
            })
        except Exception as e:
            self._send_json({"error": str(e)}, status=500)

    def _handle_video_stream(self, query):
        path_list = query.get("path")
        if not path_list:
            self.send_error(400, "Path parameter is required")
            return
        video_path = Path(path_list[0])
        if not video_path.exists() or not video_path.is_file():
            self.send_error(404, "Video file not found")
            return

        file_size = video_path.stat().st_size
        range_header = self.headers.get("Range")

        # Parse range header if present (Status 206), otherwise serve full file (Status 200)
        start = 0
        end = file_size - 1
        is_partial = False

        if range_header:
            match = re.match(r"bytes=(\d+)-(\d*)", range_header)
            if match:
                start = int(match.group(1))
                end_str = match.group(2)
                if end_str:
                    end = int(end_str)
                is_partial = True

        if start >= file_size:
            self.send_response(416, "Requested Range Not Satisfiable")
            self.send_header("Content-Range", f"bytes */{file_size}")
            self.end_headers()
            return

        chunk_size = end - start + 1
        
        self.send_response(206 if is_partial else 200)
        self.send_header("Content-Type", "video/mp4")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Access-Control-Allow-Origin", "*")
        
        if is_partial:
            self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
        
        self.send_header("Content-Length", str(chunk_size))
        self.end_headers()

        # Stream chunk-by-chunk for extreme speed and low memory usage
        try:
            with video_path.open("rb") as f:
                f.seek(start)
                remaining = chunk_size
                while remaining > 0:
                    buffer = f.read(min(remaining, 262144))  # 256KB chunks
                    if not buffer:
                        break
                    self.wfile.write(buffer)
                    remaining -= len(buffer)
        except Exception:
            # Client disconnected early during seek, which is expected
            pass

    def _handle_api_delete(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode("utf-8")
        try:
            params = json.loads(body)
            folder = Path(params.get("folder", ""))
            clip_name = params.get("clip", "")
            
            clips = scan_folder(folder)
            clip = next((c for c in clips if c.name == clip_name), None)
            if not clip:
                self._send_json({"error": "Clip not found"}, status=404)
                return

            delete_clip(clip)
            self._send_json({"success": True})
        except Exception as e:
            self._send_json({"error": str(e)}, status=500)

    def _handle_api_export(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode("utf-8")
        try:
            params = json.loads(body)
            folder = Path(params.get("folder", ""))
            clip_name = params.get("clip", "")
            view_type = params.get("view_type", "grid4")
            start_sec = float(params.get("start_sec", 0.0))
            duration_sec = float(params.get("duration_sec", 10.0))
            output_path_str = params.get("output_path", "")

            if not output_path_str:
                self._send_json({"error": "output_path is required"}, status=400)
                return
            output_path = Path(output_path_str)

            clips = scan_folder(folder)
            clip = next((c for c in clips if c.name == clip_name), None)
            if not clip:
                self._send_json({"error": "Clip not found"}, status=404)
                return

            footage = open_clip(clip)
            settings = SettingsStore().load()

            export_clip(
                clip,
                footage,
                view_type,
                output_path,
                export_start_seconds=start_sec,
                export_duration_seconds=duration_sec,
                location_text=clip.location_text,
                show_location=settings.show_location,
                show_drive_data=settings.show_drive_data,
            )
            self._send_json({"success": True, "output": str(output_path.absolute())})
        except Exception as e:
            self._send_json({"error": str(e)}, status=500)

    # -- JSON Helpers ---------------------------------------------------------

    def _send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        content = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)


def start_server(host="127.0.0.1", port=8000):
    server = ThreadingHTTPServer((host, port), TeslaCinemaAPIHandler)
    print(f"[Server] Tesla Cinema local backend running at http://{host}:{port}/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
        server.server_close()
