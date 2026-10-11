"""Run YOLOP lane segmentation on all six views and vectorize visible markings.

Exports normalized image coordinates. These are observations, not calibrated 3D lanes.
"""
from __future__ import annotations

import argparse
import base64
import json
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

CAMERAS = ('left_pillar', 'front', 'right_pillar', 'left', 'back', 'right')


def vectorize(mask: np.ndarray) -> list[list[list[float]]]:
    """Fit centerlines only inside connected detections, retaining occlusion gaps."""
    count, components, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    height, width = mask.shape
    paths = []
    for label in range(1, count):
        if stats[label, cv2.CC_STAT_AREA] < 22:
            continue
        ys, xs = np.where(components == label)
        points = np.column_stack((xs, ys)).astype(float)
        center = points.mean(axis=0)
        _, singular, axes = np.linalg.svd(points-center, full_matrices=False)
        if singular[0] < 1.8 * max(singular[1], 1):
            continue
        along = (points-center) @ axes[0]
        across = (points-center) @ axes[1]
        low, high = np.percentile(along, [2, 98])
        if high-low < 22:
            continue
        spine = []
        for value in np.linspace(low, high, max(5, int((high-low)/5))):
            selected = np.abs(along-value) < 4
            if selected.sum() < 2:
                continue
            coordinate = center + axes[0]*value + axes[1]*np.median(across[selected])
            spine.append(coordinate)
        if len(spine) < 4:
            continue
        spine = np.asarray(spine, dtype=np.float32)
        # Simplify while keeping the observed curvature. Never extrapolate endpoints.
        spine = cv2.approxPolyDP(spine[:, None, :], 1.4, False)[:, 0, :]
        paths.append([[round(float(x/width), 5), round(float(y/height), 5)] for x, y in spine])
    return paths


def classify_path(path, image):
    """Brightness ridge is evidence of paint, not proof of a lane boundary."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY).astype(float)
    height, width = gray.shape
    points = np.array(path)*[width,height]
    contrasts = []
    for start, end in zip(points[:-1],points[1:]):
        delta = end-start
        length = np.linalg.norm(delta)
        if length < 1:
            continue
        normal = np.array([-delta[1],delta[0]])/length
        for t in np.linspace(.1,.9,max(2,int(length/4))):
            point = start + t*delta
            samples = []
            for offset in [-8,-6,-2,0,2,6,8]:
                x,y = np.rint(point+normal*offset).astype(int)
                samples.append(gray[np.clip(y,0,height-1),np.clip(x,0,width-1)])
            center = max(samples[2:5])
            contrasts.append(min(center-np.mean(samples[:2]),center-np.mean(samples[-2:])))
    ratio = float(np.mean(np.array(contrasts)>8)) if contrasts else 0
    return {'points':path,'kind':'marking' if ratio>=.4 else 'boundary',
            'paint_support':round(ratio,3)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--images', type=Path, required=True)
    parser.add_argument('--model', type=Path, required=True)
    parser.add_argument('--roads', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--preview', type=Path, required=True)
    parser.add_argument('--frame', type=int)
    args = parser.parse_args()
    roads = json.loads(args.roads.read_text(encoding='utf-8'))['textures']
    session = ort.InferenceSession(str(args.model), providers=['CPUExecutionProvider'])
    mean, std = np.array([.485,.456,.406],np.float32), np.array([.229,.224,.225],np.float32)
    result = {cam: [[] for _ in roads[cam]] for cam in CAMERAS}
    previews = {}
    for cam in CAMERAS:
        indices = [args.frame] if args.frame is not None else range(len(roads[cam]))
        for index in indices:
            image = cv2.imread(str(args.images / cam / f'frame_{index:06d}.jpg'))
            if image is None:
                raise FileNotFoundError(f'{cam}/{index}')
            h, w = image.shape[:2]
            scale = 640/max(h,w)
            rw, rh = round(w*scale), round(h*scale)
            left, top = (640-rw)//2, (640-rh)//2
            canvas = np.full((640,640,3),114,np.uint8)
            canvas[top:top+rh,left:left+rw] = cv2.cvtColor(cv2.resize(image,(rw,rh)),cv2.COLOR_BGR2RGB)
            tensor = ((canvas.astype(np.float32)/255-mean)/std).transpose(2,0,1)[None].copy()
            output = session.run(['lane_line_seg'], {'images':tensor})[0][0,:,top:top+rh,left:left+rw]
            lane = (output[1] > output[0]) & (output[1] > .6)
            road = cv2.imdecode(np.frombuffer(base64.b64decode(roads[cam][index].split(',')[1]),np.uint8),cv2.IMREAD_UNCHANGED)
            road = cv2.resize(road[:,:,3],(rw,rh),interpolation=cv2.INTER_NEAREST)>100
            lane &= cv2.dilate(road.astype(np.uint8),np.ones((9,9),np.uint8))>0
            lane[:int(.35*rh)] = False
            # The rear-view lower region contains the fixed bumper and reflected road.
            if cam == 'back':
                lane[int(.8*rh):] = False
            paths = [classify_path(path,cv2.resize(image,(rw,rh))) for path in vectorize(lane)]
            result[cam][index] = paths
            if index == (args.frame if args.frame is not None else 20):
                preview = cv2.resize(image,(640,415))
                for path in paths:
                    pts = np.rint(np.array(path['points'])*[640,415]).astype(np.int32)
                    color=(255,255,255) if path['kind']=='marking' else (0,170,255)
                    cv2.polylines(preview,[pts],False,color,3,cv2.LINE_AA)
                cv2.putText(preview,f'{cam}: {len(paths)} visible segments',(10,25),0,.6,(0,240,255),2)
                previews[cam] = preview
            print(f'\r{cam} {index+1}/{len(roads[cam])}',end='',flush=True)
        print()
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps({'model':'hustvl/YOLOP yolop-640-640.onnx',
        'notes':'Road-mask constrained lane candidates; separate views, no calibration or temporal fusion',
        'moments':result},separators=(',',':')),encoding='utf-8')
    montage = np.vstack([np.hstack([previews[cam] for cam in CAMERAS[:3]]),
                         np.hstack([previews[cam] for cam in CAMERAS[3:]])])
    args.preview.parent.mkdir(parents=True,exist_ok=True)
    cv2.imwrite(str(args.preview),montage)


if __name__ == '__main__':
    main()
