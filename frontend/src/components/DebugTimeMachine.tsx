/**
 * ============================================================================
 * DebugTimeMachine.tsx — 开发态上帝模式沙盒控制台
 * ============================================================================
 *
 * 仅在开发环境渲染。该组件直接操作前端 Zustand 会话态，用于微信开发者
 * 工具与真机预览中快速穿梭 30 天生命周期，并以 overlay 方式唤起 Day30
 * 终局组件，避免频繁改后端数据或等待真实日期推进。
 * ============================================================================
 */

import React, { useCallback, useState } from 'react';
import Taro from '@tarojs/taro';
import { Button, Radio, RadioGroup, Slider, Text, View } from '@tarojs/components';
import { Day30Judgment } from './Day30Judgment';
import { useSessionStore } from '../store/session';
import type { Day30Choice, Day30JudgmentResult, LimboUserFragment, UserRole } from '../types/domain';
import './DebugTimeMachine.css';

const IS_DEV = process.env.NODE_ENV === 'development' || process.env.TARO_ENV === 'development';
const DEBUG_CONNECTION_ID = 'debug-day30-connection';
const DEBUG_MESSAGE_COUNT = 347;

interface DebugTimeMachineProps {
  /** 可选外部通知：overlay 打开时触发，不建议在这里 navigate。 */
  onEnterDay30?: () => void;
  /** 可选外部通知：mock 对方决策变化时触发。 */
  onMockCounterpartDecision?: (decision: Day30Choice) => void;
}

function describeRevealDay(day: number): string {
  if (day <= 6) return 'SILHOUETTE · 高反差纯黑剪影';
  if (day <= 14) return 'FROSTED MEMORY · 15px 毛玻璃记忆';
  if (day <= 29) return 'NEAR SIGNAL · 5px 模糊接近清晰';
  return 'FULL REVEAL · 终局完全清晰';
}

export const DebugTimeMachine: React.FC<DebugTimeMachineProps> = ({
  onEnterDay30,
  onMockCounterpartDecision,
}) => {
  const {
    currentUserId,
    currentRole,
    connectedDays,
    fragments,
    setRole,
    setConnectedDays,
    setFragments,
  } = useSessionStore();

  const [collapsed, setCollapsed] = useState(true);
  const [mockDecision, setMockDecision] = useState<Day30Choice>('COOPERATE');
  const [day30OverlayOpen, setDay30OverlayOpen] = useState(false);
  const [lastJudgmentResult, setLastJudgmentResult] = useState<Day30JudgmentResult | null>(null);

  const patchCurrentFragmentRole = useCallback(
    (nextRole: UserRole) => {
      const nextFragments = fragments.map((fragment: LimboUserFragment) => {
        if (fragment.id !== currentUserId) return fragment;
        return {
          ...fragment,
          role: nextRole,
          firePoints: nextRole === 'WATCHER' ? 0 : Math.max(1, fragment.firePoints),
        };
      });
      setFragments(nextFragments);
    },
    [currentUserId, fragments, setFragments],
  );

  const handleDaySliderChange = useCallback(
    (event: { detail?: { value?: number } }) => {
      const nextDay = Number(event.detail?.value ?? 1);
      setConnectedDays(nextDay);
    },
    [setConnectedDays],
  );

  const handleToggleGhost = useCallback(() => {
    const nextRole: UserRole = currentRole === 'ACTIVE' ? 'WATCHER' : 'ACTIVE';
    setRole(nextRole);
    patchCurrentFragmentRole(nextRole);

    Taro.vibrateShort({ type: nextRole === 'WATCHER' ? 'heavy' : 'medium' }).catch(() => undefined);
    Taro.showToast({
      title: nextRole === 'WATCHER' ? 'WATCHER sensor enabled' : 'ACTIVE rigid body restored',
      icon: 'none',
      duration: 900,
    }).catch(() => undefined);
  }, [currentRole, patchCurrentFragmentRole, setRole]);

  const handleEnterDay30 = useCallback(() => {
    setConnectedDays(30);
    setDay30OverlayOpen(true);
    onEnterDay30?.();
    Taro.vibrateShort({ type: 'heavy' }).catch(() => undefined);
  }, [onEnterDay30, setConnectedDays]);

  const handleMockDecisionChange = useCallback(
    (event: { detail?: { value?: string } }) => {
      const nextDecision = (event.detail?.value ?? 'COOPERATE') as Day30Choice;
      setMockDecision(nextDecision);
      onMockCounterpartDecision?.(nextDecision);
    },
    [onMockCounterpartDecision],
  );

  const handleJudgmentSubmitted = useCallback((result: Day30JudgmentResult) => {
    setLastJudgmentResult(result);
  }, []);

  if (!IS_DEV) {
    return null;
  }

  return (
    <>
      {collapsed ? (
        <View className='debug-tm debug-tm--collapsed' onClick={() => setCollapsed(false)}>
          <Text className='debug-tm__toggle-text'>GOD</Text>
        </View>
      ) : (
        <View className='debug-tm debug-tm--expanded'>
          <View className='debug-tm__header'>
            <View>
              <Text className='debug-tm__title'>GOD MODE</Text>
              <Text className='debug-tm__subtitle'>Development-only time machine</Text>
            </View>
            <View className='debug-tm__close' onClick={() => setCollapsed(true)}>
              <Text className='debug-tm__close-text'>×</Text>
            </View>
          </View>

          <View className='debug-tm__section'>
            <Text className='debug-tm__label'>DAY SLIDER: {connectedDays} / 30</Text>
            <Slider
              className='debug-tm__slider'
              min={1}
              max={30}
              step={1}
              value={connectedDays}
              activeColor='#38bdf8'
              backgroundColor='rgba(255,255,255,0.2)'
              blockSize={18}
              onChange={handleDaySliderChange}
              onChanging={handleDaySliderChange}
            />
            <Text className='debug-tm__hint'>{describeRevealDay(connectedDays)}</Text>
          </View>

          <View className='debug-tm__section'>
            <Button className='debug-tm__button debug-tm__button--ghost' onClick={handleToggleGhost}>
              {currentRole === 'ACTIVE' ? '幽灵开关：ACTIVE → WATCHER' : '幽灵开关：WATCHER → ACTIVE'}
            </Button>
            <Text className='debug-tm__hint'>
              LimboHall 当前用户刚体：role={currentRole}，isSensor={currentRole === 'WATCHER' ? 'true' : 'false'}。
            </Text>
          </View>

          <View className='debug-tm__section'>
            <Button className='debug-tm__button debug-tm__button--day30' onClick={handleEnterDay30}>
              直达终局：Overlay Day30Judgment
            </Button>
            <Text className='debug-tm__hint'>
              该按钮会将 connectedDays 设为 30，并在当前页面直接覆盖终局组件。
            </Text>
          </View>

          <View className='debug-tm__section'>
            <Text className='debug-tm__label'>模拟对方抉择</Text>
            <RadioGroup onChange={handleMockDecisionChange} className='debug-tm__radio-group'>
              <View className='debug-tm__radio-row'>
                <Radio value='COOPERATE' checked={mockDecision === 'COOPERATE'} color='#4ade80' />
                <Text className='debug-tm__radio-label'>COOPERATE · 双方合作时解锁 LEGACY</Text>
              </View>
              <View className='debug-tm__radio-row'>
                <Radio value='DEFECT' checked={mockDecision === 'DEFECT'} color='#f87171' />
                <Text className='debug-tm__radio-label'>DEFECT · 单防/背叛时进入 ASH</Text>
              </View>
            </RadioGroup>
          </View>

          <View className='debug-tm__footer'>
            <Text className='debug-tm__footer-text'>
              uid={currentUserId.slice(0, 8)}… · day={connectedDays} · role={currentRole} · peer={mockDecision}
            </Text>
            {lastJudgmentResult ? (
              <Text className='debug-tm__footer-text'>last outcome={lastJudgmentResult.outcome}</Text>
            ) : null}
          </View>
        </View>
      )}

      {day30OverlayOpen ? (
        <View className='debug-tm-overlay'>
          <View className='debug-tm-overlay__backdrop' onClick={() => setDay30OverlayOpen(false)} />
          <View className='debug-tm-overlay__panel'>
            <View className='debug-tm-overlay__header'>
              <Text className='debug-tm-overlay__title'>DAY 30 JUDGMENT · DEBUG OVERLAY</Text>
              <Button className='debug-tm-overlay__close' onClick={() => setDay30OverlayOpen(false)}>
                CLOSE
              </Button>
            </View>
            <Text className='debug-tm-overlay__hint'>
              Mock counterpart: {mockDecision}. 双方 COOPERATE 将进入 LEGACY；任一方 DEFECT 将进入 ASH。
            </Text>
            <Day30Judgment
              connectionId={DEBUG_CONNECTION_ID}
              userId={currentUserId}
              msgCount={DEBUG_MESSAGE_COUNT}
              connectionAlias='DEBUG DAY30 PAIR'
              debugCounterpartDecision={mockDecision}
              onSubmitted={handleJudgmentSubmitted}
            />
          </View>
        </View>
      ) : null}
    </>
  );
};

export default DebugTimeMachine;
