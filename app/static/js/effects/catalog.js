// One catalog drives both track compatibility and the Fx library cards.
export const effectCatalog = [
  { key: 'eq', title: 'fx.eq.title', description: 'fx.eq.description', targets: 'all' },
  { key: 'filters', title: 'fx.filters.title', description: 'fx.filters.description', targets: 'all' },
  { key: 'compressor', title: 'fx.compressor.title', description: 'fx.compressor.description', targets: ['vocals', 'bass'] },
  { key: 'reverb', title: 'fx.reverb.title', description: 'fx.reverb.description', targets: ['vocals'] },
  { key: 'delay', title: 'fx.delay.title', description: 'fx.delay.description', targets: ['vocals'] },
  { key: 'width', title: 'fx.width.title', description: 'fx.width.description', targets: 'width' },
  { key: 'ducking', title: 'fx.duck.title', description: 'fx.duck.description', targets: ['accompaniment', 'drums', 'bass', 'other'] },
  { key: 'saturation', title: 'fx.bass.title', description: 'fx.bass.description', targets: 'saturation' },
  { key: 'bassBoost', title: 'fx.bassBoost.title', description: 'fx.bassBoost.description', targets: 'bass' },
  { key: 'chorus', title: 'fx.chorus.title', description: 'fx.chorus.description', targets: ['vocals', 'accompaniment', 'other'] },
  { key: 'flanger', title: 'fx.flanger.title', description: 'fx.flanger.description', targets: ['vocals', 'accompaniment', 'other'] },
  { key: 'phaser', title: 'fx.phaser.title', description: 'fx.phaser.description', targets: ['vocals', 'accompaniment', 'other'] },
  { key: 'tremolo', title: 'fx.tremolo.title', description: 'fx.tremolo.description', targets: ['vocals', 'drums', 'other'] },
  { key: 'bitcrusher', title: 'fx.bitcrusher.title', description: 'fx.bitcrusher.description', targets: ['drums', 'accompaniment', 'other'] },
  { key: 'gate', title: 'fx.gate.title', description: 'fx.gate.description', targets: ['vocals', 'drums'] },
  { key: 'deEsser', title: 'fx.deEsser.title', description: 'fx.deEsser.description', targets: ['vocals'] },
  { key: 'limiter', title: 'fx.limiter.title', description: 'fx.limiter.description', targets: 'all' },
  { key: 'exciter', title: 'fx.exciter.title', description: 'fx.exciter.description', targets: ['vocals', 'accompaniment', 'other'] },
];

export function effectIsAvailable(effect, track, targets) {
  if (effect.targets === 'all') return true;
  if (effect.targets === 'width') return track === targets.width;
  if (effect.targets === 'saturation') return track === targets.saturation;
  if (effect.targets === 'bass') return track === 'bass';
  return effect.targets.includes(track);
}

export function effectTrackNames(effect, targets, translate) {
  let names = effect.targets;
  if (names === 'all') return translate('fx.availableAll');
  if (names === 'width') names = [targets.width];
  if (names === 'saturation') names = [targets.saturation];
  if (names === 'bass') names = ['bass'];
  return names.map((name) => translate(`stem.${name}`)).join(', ');
}
