"""Find reviewable front-camera lane-crossing candidates in TeslaCam video.

This is a conservative 2D screen-space baseline, not proof of a lane change.
It requires a tracked vehicle to move from one side of a visible paint line to
the other while the same line remains near the vehicle across several frames.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

from detect_lane_markings import vectorize
from detect_road_users_yolo import prepare


VEHICLE_CLASSES = {2: 'car', 5: 'bus', 7: 'truck'}


def iou(a, b):
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    intersection = max(0, x2-x1)*max(0, y2-y1)
    area_a = (a[2]-a[0])*(a[3]-a[1])
    area_b = (b[2]-b[0])*(b[3]-b[1])
    return intersection/(area_a+area_b-intersection) if area_a+area_b>intersection else 0


def detect_vehicles(session, image):
    h, w = image.shape[:2]
    blob, scale, left, top = prepare(image)
    rows = session.run(None, {session.get_inputs()[0].name: blob})[0].reshape(-1, 6)
    found = []
    for x1, y1, x2, y2, score, category in rows:
        kind = VEHICLE_CLASSES.get(int(category))
        if kind is None or score < .55:
            continue
        box = np.clip((np.array([x1-left, y1-top, x2-left, y2-top])/scale)/[w,h,w,h], 0, 1)
        if box[2]-box[0] < .025 or box[3]-box[1] < .035:
            continue
        found.append({'kind':kind,'score':float(score),'box':box.tolist()})
    result = []
    for item in sorted(found, key=lambda row:-row['score']):
        if not any(iou(item['box'], other['box'])>.5 for other in result):
            result.append(item)
    return result


def detect_markings(session, image):
    h,w = image.shape[:2]
    scale=640/max(h,w)
    rw,rh=round(w*scale),round(h*scale)
    left,top=(640-rw)//2,(640-rh)//2
    canvas=np.full((640,640,3),114,np.uint8)
    canvas[top:top+rh,left:left+rw]=cv2.cvtColor(cv2.resize(image,(rw,rh)),cv2.COLOR_BGR2RGB)
    mean=np.array([.485,.456,.406],np.float32)
    std=np.array([.229,.224,.225],np.float32)
    tensor=((canvas.astype(np.float32)/255-mean)/std).transpose(2,0,1)[None].copy()
    output=session.run(['lane_line_seg'],{'images':tensor})[0][0,:,top:top+rh,left:left+rw]
    mask=(output[1]>output[0])&(output[1]>.6)
    mask[:int(.38*rh)]=False
    return [[[float(x),float(y)] for x,y in path] for path in vectorize(mask)]


def line_x_at_y(path, y):
    crosses=[]
    for (x1,y1),(x2,y2) in zip(path[:-1],path[1:]):
        if min(y1,y2)<=y<=max(y1,y2) and abs(y2-y1)>.001:
            crosses.append(x1+(x2-x1)*(y-y1)/(y2-y1))
    return float(np.median(crosses)) if crosses else None


def observation(item, paths):
    box=item['box']
    foot_x=(box[0]+box[2])/2
    foot_y=min(.97,box[3])
    lines=[]
    for path in paths:
        x=line_x_at_y(path,foot_y)
        if x is not None and abs(x-foot_x)<.20:
            lines.append(x)
    if not lines:
        return None
    line=min(lines,key=lambda x:abs(x-foot_x))
    return {'vehicle_x':foot_x,'vehicle_y':foot_y,'line_x':line,
            'offset':foot_x-line,'box':box,'score':item['score']}


def find_crossings(history, fps):
    candidates=[]
    # Require at least three observed frames on both sides, a continuously
    # visible marking, and a stable line location. A gap is not bridged.
    for track_id, samples in history.items():
        for k in range(3,len(samples)-2):
            window=samples[k-3:k+3]
            if any(b['frame']!=a['frame']+1 for a,b in zip(window[:-1],window[1:])):
                continue
            obs=[row['marking'] for row in window]
            if any(row is None for row in obs):
                continue
            line_x=[row['line_x'] for row in obs]
            # A sudden jump to a neighbouring painted line changes the sign
            # without the vehicle crossing anything. Keep line identity local.
            if any(abs(b-a)>.025 for a,b in zip(line_x[:-1],line_x[1:])):
                continue
            before=np.median([row['offset'] for row in obs[:3]])
            after=np.median([row['offset'] for row in obs[3:]])
            if before*after>=0 or min(abs(before),abs(after))<.018:
                continue
            if not all(row['offset']*before>0 for row in obs[:2]):
                continue
            if not all(row['offset']*after>0 for row in obs[-2:]):
                continue
            start,end=window[0]['time'],window[-1]['time']
            if candidates and candidates[-1]['track_id']==track_id and start-candidates[-1]['end_seconds']<2:
                continue
            candidates.append({'track_id':track_id,'start_seconds':round(start,2),
                               'end_seconds':round(end,2),
                               'image_direction':'right' if after>before else 'left',
                               'evidence_frames':[row['frame'] for row in window],
                               'evidence':[{'time_seconds':round(row['time'],2),
                                            'box':row['box'],
                                            'foot_x':round(mark['vehicle_x'],4),
                                            'foot_y':round(mark['vehicle_y'],4),
                                            'line_x':round(mark['line_x'],4),
                                            'offset':round(mark['offset'],4)}
                                           for row,mark in zip(window,obs)],
                               'review_status':'unverified',
                               'note':'2D 标线跨越候选；需回看原片确认目标身份、本车运动与标线归属'})
    return sorted(candidates,key=lambda row:row['start_seconds'])


def front_segments(folder):
    files=sorted(folder.glob('*-front.mp4'))
    if not files:
        raise FileNotFoundError(f'No front-camera MP4 in {folder}')
    result=[]
    offset=0.
    for file in files:
        cap=cv2.VideoCapture(str(file))
        fps=cap.get(cv2.CAP_PROP_FPS)
        duration=cap.get(cv2.CAP_PROP_FRAME_COUNT)/fps if fps else 0
        cap.release()
        if duration<=0:
            raise ValueError(f'Cannot read {file}')
        result.append((offset,offset+duration,file))
        offset+=duration
    return result


def analyze(folder, vehicle_model, lane_model, start, duration, fps):
    segments=front_segments(folder)
    detector=ort.InferenceSession(str(vehicle_model),providers=['CPUExecutionProvider'])
    lanes=ort.InferenceSession(str(lane_model),providers=['CPUExecutionProvider'])
    frames=[]
    tracks={}
    next_id=1
    cap=None
    active_file=None
    try:
        count=min(int(duration*fps),int(max(0,segments[-1][1]-start)*fps))
        for index in range(count):
            second=start+index/fps
            segment=next(((a,b,file) for a,b,file in segments if a<=second<b),None)
            if segment is None: break
            a,_,file=segment
            if file!=active_file:
                if cap is not None: cap.release()
                cap=cv2.VideoCapture(str(file));active_file=file
            cap.set(cv2.CAP_PROP_POS_MSEC,(second-a)*1000)
            ok,image=cap.read()
            if not ok: continue
            vehicles=detect_vehicles(detector,image)
            paths=detect_markings(lanes,image)
            used=set()
            for item in vehicles:
                possible=[]
                for track_id,rows in tracks.items():
                    if track_id in used or not rows or rows[-1]['frame']!=index-1: continue
                    similarity=iou(item['box'],rows[-1]['box'])
                    if similarity>.3: possible.append((similarity,track_id))
                if possible:
                    track_id=max(possible)[1]
                else:
                    track_id=next_id;next_id+=1;tracks[track_id]=[]
                used.add(track_id)
                tracks[track_id].append({'frame':index,'time':second,'box':item['box'],
                                         'marking':observation(item,paths)})
            frames.append({'time_seconds':round(second,2),'vehicle_count':len(vehicles),
                           'marking_count':len(paths)})
            print(f'\rAnalyzed {index+1}/{count}',end='',flush=True)
    finally:
        if cap is not None: cap.release()
    print()
    return {'source':str(folder),'camera':'front','start_seconds':start,'sample_fps':fps,
            'method':'YOLO26 vehicle boxes + YOLOP markings + IoU tracks + sustained 2D crossing',
            'limitations':'Candidates require original-video review; missing candidates do not prove no lane changes. No calibrated depth or cross-camera tracking.',
            'frames':frames,'tracks':len(tracks),'candidates':find_crossings(tracks,fps)}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',type=Path,required=True)
    parser.add_argument('--vehicle-model',type=Path,required=True)
    parser.add_argument('--lane-model',type=Path,required=True)
    parser.add_argument('--start',type=float,default=0)
    parser.add_argument('--duration',type=float,default=30)
    parser.add_argument('--fps',type=float,default=2)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    if args.start<0 or args.duration<=0 or args.fps<=0: parser.error('Invalid time range or fps')
    result=analyze(args.input,args.vehicle_model,args.lane_model,args.start,args.duration,args.fps)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(f"{len(result['candidates'])} candidate(s) -> {args.output}")


if __name__=='__main__': main()
