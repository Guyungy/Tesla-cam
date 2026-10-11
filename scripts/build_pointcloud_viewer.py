"""Build a self-contained, offline WebGL viewer from a binary PLY point cloud."""

from __future__ import annotations

import argparse
import base64
import html
import re
import struct
from pathlib import Path

import numpy as np

PLY_TYPES = {
    "char": "b", "uchar": "B", "short": "h", "ushort": "H",
    "int": "i", "uint": "I", "float": "f", "double": "d",
}


def read_ply(path: Path) -> tuple[np.ndarray, np.ndarray]:
    data = path.read_bytes()
    match = re.search(br"end_header\r?\n", data)
    if not match:
        raise ValueError("Missing PLY header")
    header = data[: match.end()].decode("ascii")
    if "format binary_little_endian 1.0" not in header:
        raise ValueError("Only binary little-endian PLY is supported")
    vertex = re.search(r"element vertex (\d+)", header)
    if not vertex:
        raise ValueError("PLY has no vertices")
    count = int(vertex.group(1))
    property_lines = header.split("element vertex ", 1)[1].split("element ", 1)[0]
    fields = []
    for type_name, name in re.findall(r"^property (\w+) (\w+)\r?$", property_lines, re.M):
        if type_name not in PLY_TYPES:
            raise ValueError(f"Unsupported PLY property type: {type_name}")
        fields.append((name, "<" + PLY_TYPES[type_name]))
    dtype = np.dtype(fields)
    points = np.frombuffer(data, dtype=dtype, count=count, offset=match.end())
    coords = np.column_stack([points[axis] for axis in "xyz"]).astype(np.float32)
    rgb = np.column_stack([points[name] for name in ("red", "green", "blue")]).astype(np.uint8)
    valid = np.isfinite(coords).all(axis=1)
    return coords[valid], rgb[valid]


def build(source: Path, target: Path, title: str, max_points: int,
          cameras: int, times: int, warning: str) -> int:
    coords, colors = read_ply(source)
    if not len(coords):
        raise ValueError("Point cloud is empty")
    if len(coords) > max_points:
        indexes = np.linspace(0, len(coords) - 1, max_points, dtype=np.int64)
        coords, colors = coords[indexes], colors[indexes]
    center = np.median(coords, axis=0)
    coords -= center
    distances = np.linalg.norm(coords, axis=1)
    keep = distances <= np.percentile(distances, 98)
    coords, colors, distances = coords[keep], colors[keep], distances[keep]
    scale = np.percentile(distances, 75)
    if scale > 0:
        coords /= scale
    packed = bytearray(len(coords) * 16)
    for index, (position, color) in enumerate(zip(coords, colors)):
        struct.pack_into("<fffBBBB", packed, index * 16,
                         *map(float, position), *map(int, color), 255)
    payload = base64.b64encode(packed).decode("ascii")
    page = (TEMPLATE.replace("__TITLE__", html.escape(title))
            .replace("__COUNT__", str(len(coords)))
            .replace("__CAMERAS__", str(cameras))
            .replace("__TIMES__", str(times))
            .replace("__WARNING__", html.escape(warning))
            .replace("__PAYLOAD__", payload))
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(page, encoding="utf-8")
    return len(coords)


TEMPLATE = r'''<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>__TITLE__</title>
<style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#090d12;color:#e9eef5;font:14px system-ui,"Microsoft YaHei",sans-serif}
canvas{width:100%;height:100%;display:block;touch-action:none}.panel{position:fixed;top:22px;left:22px;max-width:min(410px,calc(100vw - 44px));padding:18px 20px;border:1px solid #ffffff26;border-radius:16px;background:#111923dd;backdrop-filter:blur(14px);box-shadow:0 12px 40px #0008}
h1{font-size:18px;margin:0 0 8px}.meta{color:#9eafc1;line-height:1.6}.stats{margin-top:12px;display:flex;gap:8px;flex-wrap:wrap}.chip{border:1px solid #ffffff22;border-radius:99px;padding:5px 9px;color:#d8e4ef;background:#ffffff0a}.warn{margin-top:12px;color:#f6c67b;font-size:12px;line-height:1.5}.links{display:flex;gap:16px;margin-top:12px}.links a{color:#9fd2ff;text-decoration:none}.links a:hover{text-decoration:underline}.hint{position:fixed;right:20px;bottom:17px;color:#9eafc1;font-size:12px}
</style><canvas id="view"></canvas><div class="panel"><h1>__TITLE__</h1><div class="meta">H:\TeslaCam 实拍 · 六机位同步 rig<br>鼠标拖动旋转，滚轮缩放</div><div class="stats"><span class="chip">__CAMERAS__ 个机位</span><span class="chip">__TIMES__ 个同步时刻</span><span class="chip">__COUNT__ 个显示点</span></div><div class="warn">__WARNING__</div><div class="links"><a href="six_views.jpg" target="_blank">六路原始画面 ↗</a><a href="DIAGNOSTICS.md" target="_blank">重建诊断 ↗</a></div></div><div class="hint">离线 WebGL 点云查看器 · 双击复位</div>
<script>
const binary=atob('__PAYLOAD__');const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
const canvas=document.getElementById('view'),gl=canvas.getContext('webgl',{antialias:true});if(!gl)throw Error('需要 WebGL');
function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s}
const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,`attribute vec3 pos;attribute vec3 color;uniform float yaw,pitch,zoom,aspect;varying vec3 rgb;void main(){float cy=cos(yaw),sy=sin(yaw),cp=cos(pitch),sp=sin(pitch);vec3 p=vec3(cy*pos.x+sy*pos.z,pos.y,-sy*pos.x+cy*pos.z);p=vec3(p.x,cp*p.y-sp*p.z,sp*p.y+cp*p.z);float depth=max(0.3,zoom-p.z);gl_Position=vec4(p.x/(depth*aspect)*2.0,p.y/depth*2.0,0.0,1.0);gl_PointSize=clamp(8.0/depth,2.0,7.0);rgb=color;}`));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,`precision mediump float;varying vec3 rgb;void main(){gl_FragColor=vec4(rgb,1.0);}`));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,bytes,gl.STATIC_DRAW);const p=gl.getAttribLocation(program,'pos'),c=gl.getAttribLocation(program,'color');gl.enableVertexAttribArray(p);gl.vertexAttribPointer(p,3,gl.FLOAT,false,16,0);gl.enableVertexAttribArray(c);gl.vertexAttribPointer(c,3,gl.UNSIGNED_BYTE,true,16,12);
let yaw=.5,pitch=-.25,zoom=2.8,drag=false,lastX=0,lastY=0;function draw(){const ratio=devicePixelRatio||1;canvas.width=Math.round(canvas.clientWidth*ratio);canvas.height=Math.round(canvas.clientHeight*ratio);gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(.035,.051,.071,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.uniform1f(gl.getUniformLocation(program,'yaw'),yaw);gl.uniform1f(gl.getUniformLocation(program,'pitch'),pitch);gl.uniform1f(gl.getUniformLocation(program,'zoom'),zoom);gl.uniform1f(gl.getUniformLocation(program,'aspect'),canvas.width/canvas.height);gl.drawArrays(gl.POINTS,0,bytes.length/16)}
canvas.addEventListener('pointerdown',e=>{drag=true;lastX=e.clientX;lastY=e.clientY;canvas.setPointerCapture(e.pointerId)});canvas.addEventListener('pointermove',e=>{if(!drag)return;yaw+=(e.clientX-lastX)*.006;pitch=Math.max(-1.5,Math.min(1.5,pitch+(e.clientY-lastY)*.006));lastX=e.clientX;lastY=e.clientY;draw()});canvas.addEventListener('pointerup',()=>drag=false);canvas.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(1.2,Math.min(15,zoom*Math.exp(e.deltaY*.001)));draw()},{passive:false});canvas.addEventListener('dblclick',()=>{yaw=.5;pitch=-.25;zoom=2.8;draw()});addEventListener('resize',draw);draw();
</script></html>'''


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--title", default="TeslaCam 六视角 3D 重建演示")
    parser.add_argument("--max-points", type=int, default=100_000)
    parser.add_argument("--cameras", type=int, default=6)
    parser.add_argument("--times", type=int, default=11)
    parser.add_argument("--warning", default="前摄与其他机位没有可验证的同步重叠；相机位姿基于近似车身布局。此点云仅为探索性演示，不可用于测量。")
    args = parser.parse_args()
    if args.max_points < 1:
        parser.error("--max-points must be positive")
    count = build(args.input, args.output, args.title, args.max_points,
                  args.cameras, args.times, args.warning)
    print(f"Wrote {count} points to {args.output}")


if __name__ == "__main__":
    main()
