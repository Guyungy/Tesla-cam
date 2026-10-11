"""Build a self-contained six-camera comparison page for a TeslaCam reconstruction."""

from __future__ import annotations

import argparse
import base64
import io
import json
import struct
from pathlib import Path

import numpy as np
from PIL import Image

from build_pointcloud_viewer import read_ply

CAMERAS = [
    ("left_pillar", "左柱摄像头"), ("front", "前摄像头"),
    ("right_pillar", "右柱摄像头"), ("left", "左后视摄像头"),
    ("back", "后摄像头"), ("right", "右后视摄像头"),
]


def build(images: Path, cloud: Path, output: Path, frames: int) -> None:
    photo_data: dict[str, list[str]] = {}
    for camera, _ in CAMERAS:
        photos = []
        for index in range(frames):
            source = images / camera / f"frame_{index:06d}.jpg"
            with Image.open(source) as raw:
                image = raw.convert("RGB")
                image.thumbnail((800, 520), Image.Resampling.LANCZOS)
                stream = io.BytesIO()
                image.save(stream, "JPEG", quality=76, optimize=True)
                photos.append("data:image/jpeg;base64," + base64.b64encode(stream.getvalue()).decode())
        photo_data[camera] = photos

    coords, colors = read_ply(cloud)
    center = np.median(coords, axis=0)
    coords = coords - center
    distance = np.linalg.norm(coords, axis=1)
    keep = distance <= np.percentile(distance, 98)
    coords, colors, distance = coords[keep], colors[keep], distance[keep]
    coords /= max(float(np.percentile(distance, 75)), 1e-6)
    packed = bytearray(len(coords) * 16)
    for index, (point, color) in enumerate(zip(coords, colors)):
        struct.pack_into("<fffBBBB", packed, index * 16,
                         *map(float, point), *map(int, color), 255)
    cloud_data = base64.b64encode(packed).decode()
    tiles = "".join(
        f'<button class="tile" data-camera="{camera}" title="点击放大">'
        f'<img alt="{label}" decoding="async"><span class="label">{label}</span>'
        f'<span class="tile-zoom">点击放大 ↗</span></button>'
        for camera, label in CAMERAS
    )
    page = (TEMPLATE.replace("__TILES__", tiles)
            .replace("__FRAMES__", json.dumps(photo_data, ensure_ascii=False))
            .replace("__CLOUD__", cloud_data)
            .replace("__COUNT__", f"{len(coords):,}")
            .replace("__LAST__", str(frames - 1)))
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(page, encoding="utf-8")
    print(f"Wrote {frames} synchronized six-camera moments and {len(coords)} points to {output}")


TEMPLATE = r'''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TeslaCam 六视角实拍与 3D 重建对照</title>
<style>
:root{color-scheme:dark;font:15px/1.45 system-ui,"Microsoft YaHei",sans-serif;background:#090e14;color:#eaf1f8}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 50% -15%,#21344a 0,#0c131d 34%,#090e14 70%);min-height:100vh}.shell{max-width:1550px;margin:auto;padding:22px clamp(14px,3vw,36px) 40px}.top{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:18px}.eyebrow{color:#64d9bd;letter-spacing:.15em;font-size:12px;font-weight:800}h1{font-size:clamp(25px,3vw,39px);line-height:1.12;margin:6px 0 9px;letter-spacing:-.03em}.sub{color:#aab8c8;margin:0;max-width:800px}.headlinks{display:flex;gap:10px;flex-wrap:wrap}.headlinks a{color:#cae5ff;text-decoration:none;border:1px solid #ffffff26;border-radius:10px;padding:9px 12px;background:#ffffff0b;white-space:nowrap}.headlinks a:hover{background:#ffffff1b}.notice{display:flex;align-items:center;gap:11px;background:#142337;border:1px solid #335174;border-radius:14px;padding:11px 15px;margin:0 0 16px;color:#d7e9fb}.notice b{color:#fff}.notice .dot{flex:none;width:10px;height:10px;background:#f8b666;border-radius:50%;box-shadow:0 0 15px #f8b66688}.sectiontitle{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:0 0 9px}.sectiontitle h2{font-size:18px;margin:0}.sectiontitle small{color:#8fa4b8}.pill{background:#14352f;border:1px solid #276959;color:#84e6ca;padding:4px 10px;border-radius:99px;font-size:12px;font-weight:700}.playbar{display:flex;gap:12px;align-items:center;background:#111d2a;border:1px solid #2a3d50;border-radius:14px;padding:10px 14px;margin-bottom:12px}.playbar button{background:#79e8cc;border:0;color:#0d251e;border-radius:9px;min-width:86px;padding:9px 13px;font-weight:800;cursor:pointer}.playbar button:hover{background:#a0f2dc}.playbar input{flex:1;min-width:80px;accent-color:#79e8cc;cursor:pointer}.time{font-variant-numeric:tabular-nums;color:#d6e5f4;min-width:82px;text-align:right}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.tile{position:relative;display:block;border:1px solid #3a4d5e;border-radius:12px;overflow:hidden;background:#121d27;padding:0;aspect-ratio:1.75;cursor:zoom-in;text-align:left}.tile:hover{border-color:#87d4f1}.tile img{display:block;width:100%;height:100%;object-fit:cover}.label{position:absolute;left:10px;top:9px;background:#07111cce;padding:5px 9px;border:1px solid #ffffff29;border-radius:7px;color:#fff;font-size:13px;font-weight:750}.tile-zoom{position:absolute;right:10px;bottom:9px;background:#07111cbd;padding:4px 7px;border-radius:6px;color:#e5f5ff;font-size:11px;opacity:0}.tile:hover .tile-zoom{opacity:1}.result{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(280px,.8fr);gap:13px;margin-top:22px}.card{border:1px solid #293e51;border-radius:16px;background:#101b28;overflow:hidden}.cardhead{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px 10px}.cardhead h2{margin:0;font-size:18px}.cardhead small{color:#8fa4b8}.cloud-wrap{height:330px;position:relative;background:#080d13}#cloud{width:100%;height:100%;display:block;touch-action:none}.cloud-tip{position:absolute;left:14px;bottom:12px;color:#a8bace;background:#07111cbb;padding:5px 8px;border-radius:6px;font-size:12px;pointer-events:none}.cardfoot{padding:12px 16px;color:#becddd;border-top:1px solid #25384a;font-size:13px}.explain{padding:16px 18px}.explain h2{margin:0 0 12px;font-size:18px}.explain p{margin:8px 0;color:#b8c8d7}.status{display:flex;gap:10px;align-items:flex-start;background:#422e20;border:1px solid #755235;color:#ffdbad;border-radius:10px;padding:10px;margin:12px 0}.status strong{font-size:13px}.groups{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:18px 0}.group{border:1px solid #537c75;border-radius:10px;padding:9px 12px;background:#16332f;color:#b8f2dc;font-size:13px;font-weight:700}.group.isolated{border-color:#9b6d48;background:#3a291f;color:#ffd9b4}.broken{color:#ffbd80;font-weight:800}.micro{font-size:12px!important;color:#90a5b8!important}dialog{padding:0;border:1px solid #5b758f;border-radius:16px;background:#0d1721;color:#fff;max-width:min(94vw,1500px);max-height:92vh;box-shadow:0 25px 100px #000c}dialog::backdrop{background:#000d}.modalhead{display:flex;justify-content:space-between;align-items:center;padding:10px 14px}.modalhead button{border:0;background:#2d4559;color:#fff;padding:7px 11px;border-radius:8px;cursor:pointer}dialog img{display:block;max-width:92vw;max-height:82vh;object-fit:contain}@media(max-width:850px){.top{display:block}.headlinks{margin-top:14px}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.result{grid-template-columns:1fr}}@media(max-width:520px){.grid{gap:6px}.tile{aspect-ratio:1.35}.label{font-size:11px}.notice{font-size:13px}.sectiontitle small{display:none}.cloud-wrap{height:270px}}
</style></head><body><main class="shell">
<header class="top"><div><div class="eyebrow">H:\TESLACAM · REAL FOOTAGE</div><h1>六视角实拍与 3D 重建对照</h1><p class="sub">上面是同一时刻的六路真实画面，拖动时间轴可同步查看。下面是这些画面目前实际算出的点云。</p></div><nav class="headlinks"><a href="viewer.html">车辆与行人 3D 示意 ↗</a><a href="six_views.jpg" target="_blank">六路截图 ↗</a><a href="DIAGNOSTICS.md" target="_blank">实验结果 ↗</a><a href="pointcloud.html" target="_blank">点云全屏 ↗</a></nav></header>
<div class="notice"><span class="dot"></span><span><b>先看真实画面，再看重建结果：</b>目前绿色点无法组成清楚的道路或车辆，原因是六相机之间缺少可靠标定。这里展示真实计算结果，不把缺失部分补画成 3D。</span></div>
<div class="sectiontitle"><h2>① 六路摄像头 · 同步实拍</h2><span class="pill">真实视频抽帧</span></div>
<div class="playbar"><button id="play" type="button">▶ 播放</button><input id="seek" type="range" min="0" max="__LAST__" value="0" step="1" aria-label="同步时间轴"><span class="time" id="time">00:00 / 00:__LAST__</span></div>
<section class="grid" aria-label="六路同步画面">__TILES__</section>
<section class="result"><div class="card"><div class="cardhead"><h2>② 目前实际重建出的 3D</h2><small>__COUNT__ 个可显示点 · 拖动旋转</small></div><div class="cloud-wrap"><canvas id="cloud"></canvas><span class="cloud-tip">鼠标拖动旋转 · 滚轮缩放 · 双击复位</span></div><div class="cardfoot">这些亮点是图像匹配后估计的空间点。画面出现断裂和漂浮，说明这份模型还不能作为可交付的道路场景。</div></div>
<aside class="card explain"><h2>为什么还不像真实道路？</h2><p>六路画面都能读到，但目前的图像匹配只把五路侧后方相机连成一组：</p><div class="groups"><span class="group isolated">前摄</span><span class="broken">✕ 未对齐</span><span class="group">后摄 · 左右后视 · 左右柱摄</span></div><div class="status"><strong>当前状态：六路同步成功，六路空间标定未完成。</strong></div><p>要让下方变成连续 3D，需要让前摄与侧摄拍到同一批静态场景，再计算真实镜头参数和安装位置。</p><p class="micro">本页不用于距离或尺寸测量。原始录像位于 H:\，未被修改。</p></aside></section>
</main><dialog id="zoom"><div class="modalhead"><strong id="zoomlabel"></strong><button id="close" type="button">关闭 ×</button></div><img id="zoomimg" alt="放大的摄像头画面"></dialog>
<script>
const frames=__FRAMES__, frameCount=__LAST__+1;
const tiles=[...document.querySelectorAll('.tile')],seek=document.getElementById('seek'),clock=document.getElementById('time'),play=document.getElementById('play');let current=0,timer=null;
const pad=n=>String(n).padStart(2,'0');function show(index){current=Math.min(frameCount-1,Math.max(0,index));seek.value=current;clock.textContent=`00:${pad(current)} / 00:${pad(frameCount-1)}`;for(const tile of tiles){tile.querySelector('img').src=frames[tile.dataset.camera][current]}if(document.getElementById('zoom').open){const selected=document.getElementById('zoom').dataset.camera;document.getElementById('zoomimg').src=frames[selected][current]}}
function stop(){clearInterval(timer);timer=null;play.textContent='▶ 播放'}play.addEventListener('click',()=>{if(timer){stop();return}play.textContent='❚❚ 暂停';timer=setInterval(()=>show((current+1)%frameCount),1000)});seek.addEventListener('input',()=>show(Number(seek.value)));
const modal=document.getElementById('zoom');tiles.forEach(tile=>tile.addEventListener('click',()=>{modal.dataset.camera=tile.dataset.camera;document.getElementById('zoomlabel').textContent=tile.querySelector('.label').textContent+` · 第 ${current+1} 秒`;document.getElementById('zoomimg').src=frames[tile.dataset.camera][current];modal.showModal()}));document.getElementById('close').addEventListener('click',()=>modal.close());modal.addEventListener('click',e=>{if(e.target===modal)modal.close()});show(0);
const raw=atob('__CLOUD__'),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);const canvas=document.getElementById('cloud'),gl=canvas.getContext('webgl',{antialias:true});if(!gl)throw Error('需要 WebGL');function shader(t,s){let x=gl.createShader(t);gl.shaderSource(x,s);gl.compileShader(x);if(!gl.getShaderParameter(x,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(x));return x}let program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,`attribute vec3 pos;attribute vec3 color;uniform float yaw,pitch,zoom,aspect;varying vec3 rgb;void main(){float cy=cos(yaw),sy=sin(yaw),cp=cos(pitch),sp=sin(pitch);vec3 p=vec3(cy*pos.x+sy*pos.z,pos.y,-sy*pos.x+cy*pos.z);p=vec3(p.x,cp*p.y-sp*p.z,sp*p.y+cp*p.z);float depth=max(0.3,zoom-p.z);gl_Position=vec4(p.x/(depth*aspect)*2.0,p.y/depth*2.0,0.0,1.0);gl_PointSize=clamp(8.0/depth,2.0,7.0);rgb=color;}`));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,`precision mediump float;varying vec3 rgb;void main(){gl_FragColor=vec4(rgb,1.0);}`));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);let buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,bytes,gl.STATIC_DRAW);const p=gl.getAttribLocation(program,'pos'),c=gl.getAttribLocation(program,'color');gl.enableVertexAttribArray(p);gl.vertexAttribPointer(p,3,gl.FLOAT,false,16,0);gl.enableVertexAttribArray(c);gl.vertexAttribPointer(c,3,gl.UNSIGNED_BYTE,true,16,12);let yaw=.5,pitch=-.25,zoom=2.8,drag=false,lastX=0,lastY=0;function draw(){const ratio=devicePixelRatio||1;canvas.width=Math.round(canvas.clientWidth*ratio);canvas.height=Math.round(canvas.clientHeight*ratio);gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(.035,.051,.071,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.uniform1f(gl.getUniformLocation(program,'yaw'),yaw);gl.uniform1f(gl.getUniformLocation(program,'pitch'),pitch);gl.uniform1f(gl.getUniformLocation(program,'zoom'),zoom);gl.uniform1f(gl.getUniformLocation(program,'aspect'),canvas.width/canvas.height);gl.drawArrays(gl.POINTS,0,bytes.length/16)}canvas.addEventListener('pointerdown',e=>{drag=true;lastX=e.clientX;lastY=e.clientY;canvas.setPointerCapture(e.pointerId)});canvas.addEventListener('pointermove',e=>{if(!drag)return;yaw+=(e.clientX-lastX)*.006;pitch=Math.max(-1.5,Math.min(1.5,pitch+(e.clientY-lastY)*.006));lastX=e.clientX;lastY=e.clientY;draw()});canvas.addEventListener('pointerup',()=>drag=false);canvas.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(1.2,Math.min(15,zoom*Math.exp(e.deltaY*.001)));draw()},{passive:false});canvas.addEventListener('dblclick',()=>{yaw=.5;pitch=-.25;zoom=2.8;draw()});addEventListener('resize',draw);draw();
</script></body></html>'''


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--images", type=Path, required=True)
    parser.add_argument("--cloud", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--frames", type=int, default=20)
    args = parser.parse_args()
    if args.frames < 1:
        parser.error("--frames must be positive")
    build(args.images, args.cloud, args.output, args.frames)


if __name__ == "__main__":
    main()
