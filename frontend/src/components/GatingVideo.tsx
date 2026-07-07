import React, { useMemo } from 'react';
import { Text, Video, View } from '@tarojs/components';
import './GatingVideo.css';

/**
 * Phase 0 Security Fix:
 * GatingVideo no longer applies client-side CSS filters to a full-resolution source.
 * Instead, it expects the backend to provide a pre-processed video URL at the appropriate
 * reveal level. The `src` prop should already point to the correct server-side blurred variant.
 *
 * Video reveal levels (server-side transcoded):
 *   - SILHOUETTE (Day 1-6):   High-contrast black/white silhouette video
 *   - FROSTED (Day 7-14):     Heavy Gaussian blur + grayscale
 *   - NEAR (Day 15-29):       Light blur, partial color
 *   - FULL (Day 30):          Original video, signed temporary URL
 *
 * The frontend only displays what the server provides — no client-side filter bypass possible.
 */

export interface GatingVideoProps {
  /** Server-provided video URL at the appropriate reveal level */
  src: string;
  /** Current connected days (used for UI display only, NOT for access control) */
  connectedDays: number;
  /** The reveal level as determined by the server */
  revealLevel: RevealLevel;
  poster?: string;
  autoplay?: boolean;
  muted?: boolean;
  controls?: boolean;
  loop?: boolean;
  title?: string;
}

export type RevealLevel = 'SILHOUETTE' | 'FROSTED' | 'NEAR' | 'FULL';

export interface GateVisualState {
  normalizedDays: number;
  label: string;
  revealPercent: number;
  level: RevealLevel;
}

export const normalizeConnectedDays = (connectedDays: number): number => {
  if (!Number.isFinite(connectedDays)) {
    return 1;
  }
  return Math.min(30, Math.max(1, Math.trunc(connectedDays)));
};

export const resolveGateVisualState = (connectedDays: number, revealLevel: RevealLevel): GateVisualState => {
  const day = normalizeConnectedDays(connectedDays);

  const labelMap: Record<RevealLevel, string> = {
    SILHOUETTE: '剪影',
    FROSTED: '磨砂记忆',
    NEAR: '近信号',
    FULL: '完全揭示'
  };

  return {
    normalizedDays: day,
    label: labelMap[revealLevel],
    revealPercent: Math.round((day / 30) * 100),
    level: revealLevel
  };
};

export const GatingVideo: React.FC<GatingVideoProps> = ({
  src,
  connectedDays,
  revealLevel,
  poster,
  autoplay = false,
  muted = true,
  controls = true,
  loop = false,
  title = 'Shadow Video'
}) => {
  const visualState = useMemo(() => resolveGateVisualState(connectedDays, revealLevel), [connectedDays, revealLevel]);

  return (
    <View className='gating-video'>
      <View className='gating-video__meta'>
        <Text className='gating-video__title'>{title}</Text>
        <Text className='gating-video__day'>DAY {visualState.normalizedDays}/30 · {visualState.label}</Text>
      </View>
      <View className='gating-video__frame'>
        {/* No client-side filter applied — video is pre-processed server-side */}
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
          enableProgressGesture={revealLevel === 'FULL'}
        />
        {revealLevel !== 'FULL' && (
          <View className='gating-video__lock-overlay'>
            <Text className='gating-video__lock-text'>
              🔒 服务端加密保护 · 第{30 - visualState.normalizedDays}天后揭示
            </Text>
          </View>
        )}
      </View>
      <View className='gating-video__progress' aria-label='connection reveal progress'>
        <View className='gating-video__progress-bar' style={{ width: `${visualState.revealPercent}%` }} />
      </View>
      <Text className='gating-video__hint'>
        视频由服务端分级处理，客户端无法绕过隐私保护。
      </Text>
    </View>
  );
};

export default GatingVideo;
