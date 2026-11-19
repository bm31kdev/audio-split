// Automation curve templates use normalized time and smooth, sampled motion.
export const AUTOMATION_CURVE_PRESETS = [
  { id: 'sweep-left-right', titleKey: 'panCurves.leftRight', descriptionKey: 'panCurves.leftRightHint', valueAt: progress => -100 * Math.cos(Math.PI * progress) },
  { id: 'sweep-right-left', titleKey: 'panCurves.rightLeft', descriptionKey: 'panCurves.rightLeftHint', valueAt: progress => 100 * Math.cos(Math.PI * progress) },
  { id: 'center-left-center', titleKey: 'panCurves.centerLeft', descriptionKey: 'panCurves.centerLeftHint', valueAt: progress => 92 * Math.sin(Math.PI * progress) },
  { id: 'center-right-center', titleKey: 'panCurves.centerRight', descriptionKey: 'panCurves.centerRightHint', valueAt: progress => -92 * Math.sin(Math.PI * progress) },
  { id: 'slow-ping-pong', titleKey: 'panCurves.pingPong', descriptionKey: 'panCurves.pingPongHint', valueAt: progress => 82 * Math.sin(2 * Math.PI * progress) },
  { id: 'fast-ping-pong', titleKey: 'panCurves.fastPingPong', descriptionKey: 'panCurves.fastPingPongHint', valueAt: progress => 82 * Math.sin(4 * Math.PI * progress) },
];

// Convert a preset into points on the target track's own timeline.
export function generateCurveTemplatePoints(presetId, duration) {
  const preset = AUTOMATION_CURVE_PRESETS.find(item => item.id === presetId);
  if (!preset || !Number.isFinite(duration) || duration <= 0) return null;
  const sampleCount = 17;
  return Array.from({ length: sampleCount }, (_, index) => {
    const progress = index / (sampleCount - 1);
    return {
      time: Math.round(duration * progress * 100) / 100,
      pan: Math.round(preset.valueAt(progress)),
    };
  });
}
