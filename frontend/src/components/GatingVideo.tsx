import React, { useMemo } from 'react';
import { Text, Video, View } from '@tarojs/components';
import './GatingVideo.css';

export interface GatingVideoProps {
  src: string;
  connectedDays: number;
  poster?: string;
  autoplay?: boolean;
  muted?: boolean;
  controls?: boolean;
  loop?: boolean;
  title?: string;
}

export interface GateVisualState {
  normalizedDays: number;
  label: string;
  filter: string;
  revealPercent: number;
}

export const normalizeConnectedDays = (connectedDays: number): number => {
  if (!Number.isFinite(connectedDays)) {
    return 1;
  }

  return Math.min(30, Math.max(1, Math.trunc(connectedDays)));
};

export const resolveGateVisualState = (connectedDays: number): GateVisualState => {
  const day = normalizeConnectedDays(connectedDays);

  if (day <= 6) {
    return {
      normalizedDays: day,
      label: 'SILHOUETTE',
      filter: 'brightness(0) invert(1) drop-shadow(0 0 10px white)',
      revealPercent: Math.round((day / 30) * 100)
    };
  }

  if (day <= 14) {
    return {
      normalizedDays: day,
      label: 'FROSTED MEMORY',
      filter: 'blur(15px) grayscale(100%)',
      revealPercent: Math.round((day / 30) * 100)
    };
  }

  if (day <= 29) {
    return {
      normalizedDays: day,
      label: 'NEAR SIGNAL',
      filter: 'blur(5px) grayscale(40%)',
      revealPercent: Math.round((day / 30) * 100)
    };
  }

  return {
    normalizedDays: day,
    label: 'FULL REVEAL',
    filter: 'none',
    revealPercent: 100
  };
};

export const GatingVideo: React.FC<GatingVideoProps> = ({
  src,
  connectedDays,
  poster,
  autoplay = false,
  muted = true,
  controls = true,
  loop = false,
  title = 'Shadow Video'
}) => {
  const visualState = useMemo(() => resolveGateVisualState(connectedDays), [connectedDays]);

  return (
    <View className='gating-video'>
      <View className='gating-video__meta'>
        <Text className='gating-video__title'>{title}</Text>
        <Text className='gating-video__day'>DAY {visualState.normalizedDays}/30 · {visualState.label}</Text>
      </View>
      <View className='gating-video__frame'>
        <Video
          className='gating-video__player'
          src={src}
          poster={poster}
          autoplay={autoplay}
          muted={muted}
          controls={controls}
          loop={loop}
          objectFit='cover'
          showCenterPlayBtn
          enableProgressGesture
          style={{ filter: visualState.filter }}
        />
      </View>
      <View className='gating-video__progress' aria-label='connection reveal progress'>
        <View className='gating-video__progress-bar' style={{ width: `${visualState.revealPercent}%` }} />
      </View>
      <Text className='gating-video__hint'>No backend transcoding. Reveal is controlled by cross-end CSS filter only.</Text>
    </View>
  );
};

export default GatingVideo;
