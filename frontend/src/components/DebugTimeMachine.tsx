/**
 * ============================================================================
 * DebugTimeMachine.tsx — 上帝模式沙盒控制台 (God Mode Panel)
 * ============================================================================
 *
 * 仅在开发环境下渲染。绝对定位于屏幕右下角，半透明置顶悬浮。
 * 提供一键测试按钮，直接操作全局 Zustand 状态，用于微信开发者工具中
 * 手动验证 30 天生命周期的各阶段视觉表现。
 *
 * 功能清单：
 *   1. [Slider] 天数滑块 1-30 天 → 控制 GatingVideo 的 CSS Filter 渐变
 *   2. [Button] Toggle GHOST → 切换自己为 WATCHER，验证 LimboHall 物理表现
 *   3. [Button] 直达 Day 30 终局 → 强制拉起 Day30Judgment 组件
 *   4. [Radio] Mock 对方决策 → 伪造 COOPERATE / DEFECT 测试双向结局
 * ============================================================================
 */

import React, { useCallback, useState } from 'react';
import Taro from '@tarojs/taro';
import { Button, RadioGroup, Radio, Slider, Text, View } from '@tarojs/components';
import { useSessionStore } from '../store/session';
import type { Day30Choice, LimboUserFragment, UserRole } from '../types/domain';
import './DebugTimeMachine.css';

// 仅在开发环境下渲染
const IS_DEV = process.env.NODE_ENV === 'development' || process.env.TARO_ENV === 'development';

interface DebugTimeMachineProps {
  /** 外部回调：当用户点击"直达 Day 30"时触发 */
  onEnterDay30?: () => void;
  /** 外部回调：当用户 Mock 对方决策时触发 */
  onMockCounterpartDecision?: (decision: Day30Choice) => void;
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

  // ─── 功能 1: 天数滑块 ───
  const handleDaySliderChange = useCallback(
    (e: any) => {
      const value = e.detail?.value ?? e?.detail ?? 1;
      setConnectedDays(Number(value));
    },
    [setConnectedDays],
  );

  // ─── 功能 2: Toggle GHOST ───
  const handleToggleGhost = useCallback(() => {
    const nextRole: UserRole = currentRole === 'ACTIVE' ? 'WATCHER' : 'ACTIVE';
    setRole(nextRole);
    setFragments(
      fragments.map((fragment: LimboUserFragment) =>
        fragment.id === currentUserId
          ? {
              ...fragment,
              role: nextRole,
              firePoints: nextRole === 'WATCHER' ? 0 : Math.max(1, fragment.firePoints),
            }
          : fragment,
      ),
    );
    Taro.vibrateShort({ type: 'heavy' }).catch(() => undefined);
    Taro.showToast({
      title: `Role → ${nextRole}`,
      icon: 'none',
      duration: 800,
    }).catch(() => undefined);
  }, [currentRole, currentUserId, fragments, setFragments, setRole]);

  // ─── 功能 3: 直达 Day 30 终局 ───
  const handleEnterDay30 = useCallback(() => {
    setConnectedDays(30);
    if (onEnterDay30) {
      onEnterDay30();
    } else {
      Taro.navigateTo({ url: '/pages/day30/index' }).catch(() => undefined);
    }
    Taro.vibrateShort({ type: 'medium' }).catch(() => undefined);
  }, [onEnterDay30, setConnectedDays]);

  // ─── 功能 4: Mock 对方决策 ───
  const handleMockDecisionChange = useCallback(
    (e: any) => {
      const value = (e.detail?.value ?? 'COOPERATE') as Day30Choice;
      setMockDecision(value);
    },
    [],
  );

  const handleApplyMockDecision = useCallback(() => {
    onMockCounterpartDecision?.(mockDecision);
    Taro.showToast({
      title: `Mock: counterpart → ${mockDecision}`,
      icon: 'none',
      duration: 1200,
    }).catch(() => undefined);
  }, [mockDecision, onMockCounterpartDecision]);

  // ─── 环境守卫 ───
  if (!IS_DEV) {
    return null;
  }

  // ─── 折叠态：只显示一个小按钮 ───
  if (collapsed) {
    return (
      <View className='debug-tm debug-tm--collapsed' onClick={() => setCollapsed(false)}>
        <Text className='debug-tm__toggle-text'>⚡ GOD</Text>
      </View>
    );
  }

  // ─── 展开态：完整面板 ───
  return (
    <View className='debug-tm debug-tm--expanded'>
      {/* 标题栏 */}
      <View className='debug-tm__header'>
        <Text className='debug-tm__title'>⚡ GOD MODE</Text>
        <View className='debug-tm__close' onClick={() => setCollapsed(true)}>
          <Text className='debug-tm__close-text'>×</Text>
        </View>
      </View>

      {/* 功能 1: 天数滑块 */}
      <View className='debug-tm__section'>
        <Text className='debug-tm__label'>DAY: {connectedDays} / 30</Text>
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
        />
        <Text className='debug-tm__hint'>
          {connectedDays <= 6
            ? '🌑 SILHOUETTE (纯黑高光剪影)'
            : connectedDays <= 14
            ? '🌫️ FROSTED (毛玻璃)'
            : connectedDays <= 29
            ? '📡 NEAR SIGNAL (接近清晰)'
            : '☀️ FULL REVEAL (完全清晰)'}
        </Text>
      </View>

      {/* 功能 2: Toggle GHOST */}
      <View className='debug-tm__section'>
        <Button
          className='debug-tm__button debug-tm__button--ghost'
          onClick={handleToggleGhost}
        >
          {currentRole === 'ACTIVE' ? '👻 Toggle → WATCHER' : '🔥 Toggle → ACTIVE'}
        </Button>
        <Text className='debug-tm__hint'>
          当前: {currentRole} | isSensor={currentRole === 'WATCHER' ? 'true' : 'false'}
        </Text>
      </View>

      {/* 功能 3: 直达 Day 30 */}
      <View className='debug-tm__section'>
        <Button
          className='debug-tm__button debug-tm__button--day30'
          onClick={handleEnterDay30}
        >
          🎯 直达 Day 30 终局
        </Button>
      </View>

      {/* 功能 4: Mock 对方决策 */}
      <View className='debug-tm__section'>
        <Text className='debug-tm__label'>MOCK 对方决策:</Text>
        <RadioGroup onChange={handleMockDecisionChange} className='debug-tm__radio-group'>
          <View className='debug-tm__radio-row'>
            <Radio
              value='COOPERATE'
              checked={mockDecision === 'COOPERATE'}
              color='#4ade80'
              className='debug-tm__radio'
            />
            <Text className='debug-tm__radio-label'>COOPERATE (交出钥匙)</Text>
          </View>
          <View className='debug-tm__radio-row'>
            <Radio
              value='DEFECT'
              checked={mockDecision === 'DEFECT'}
              color='#f87171'
              className='debug-tm__radio'
            />
            <Text className='debug-tm__radio-label'>DEFECT (保留防御)</Text>
          </View>
        </RadioGroup>
        <Button
          className='debug-tm__button debug-tm__button--apply'
          onClick={handleApplyMockDecision}
        >
          ✅ Apply Mock Decision
        </Button>
      </View>

      {/* 状态摘要 */}
      <View className='debug-tm__footer'>
        <Text className='debug-tm__footer-text'>
          uid: {currentUserId.slice(0, 8)}… | day: {connectedDays} | role: {currentRole}
        </Text>
      </View>
    </View>
  );
};

export default DebugTimeMachine;
