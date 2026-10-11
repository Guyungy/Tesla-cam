// User-adjustable size priors, not measured dimensions or Tesla calibration.
export const HEIGHT_PRIORS = {
  car: [1.35, 1.65, 2.1], bus: [2.2, 2.8, 3.8], truck: [2.2, 3.1, 4.2],
  person: [1.45, 1.7, 1.95], motorbike: [.8, 1.1, 1.5], bicycle: [.8, 1.1, 1.4],
};

export function estimateDistance(item, {fov, aspect, fovError = 15}, peers = []) {
  const prior = HEIGHT_PRIORS[item.kind];
  const box = item.box;
  const unavailable = reason => ({valid:false, reason});
  if (!prior || !Array.isArray(box) || box.length !== 4 ||
      !box.every(Number.isFinite) || box.some(v => v < 0 || v > 1) ||
      !Number.isFinite(aspect) || !(aspect > 0) || !(fov > 20 && fov < 160) || !Number.isFinite(fovError) || fovError < 0)
    return unavailable('参数不完整');
  const [x1,y1,x2,y2] = box;
  if (x2 <= x1 || y2 <= y1) return unavailable('检测框无效');
  if (x1 < .01 || x2 > .99 || y1 < .01 || y2 > .99) return unavailable('目标被画面裁切');
  if (y2-y1 < .025) return unavailable('目标太小');
  const u = (x1+x2)/2;
  if (fov > 90 && Math.abs(u-.5) > .36) return unavailable('广角边缘畸变较大');
  if (peers.some(other => other !== item && other.score >= .6 &&
      other.box[0] < u && other.box[2] > u && other.box[1] < y2 && other.box[3] > y2+.02))
    return unavailable('目标下沿可能被遮挡');
  const calculate = (height, angle, span) => {
    const fx = 1/(2*Math.tan(angle*Math.PI/360));
    const z = height * fx * aspect / span;
    const x = (u-.5)*z/fx;
    return {z, x, distance:Math.hypot(x,z), bearing:Math.atan2(x,z)};
  };
  const central = calculate(prior[1], fov, y2-y1);
  const low = calculate(prior[0], Math.min(159,fov+fovError), (y2-y1)*1.1).distance;
  const high = calculate(prior[2], Math.max(21,fov-fovError), (y2-y1)*.9).distance;
  return {valid:true,...central,low,high,height:prior[1],heightRange:[prior[0],prior[2]],
    reason:'目标尺寸先验与针孔近似；范围为参数敏感性，不是统计置信区间'};
}

export function distanceText(estimate) {
  if (!estimate.valid) return '暂不估距';
  return `约 ${Math.round(estimate.distance)} m`;
}

export function distanceRangeText(estimate) {
  return estimate.valid ? `${Math.max(0,Math.floor(estimate.low))}–${Math.ceil(estimate.high)} m` : estimate.reason;
}
