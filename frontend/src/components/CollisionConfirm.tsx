import React, { useCallback, useEffect, useState } from 'react';
import Taro from '@tarojs/taro';
import { Button, Text, View } from '@tarojs/components';
import type { LimboUserFragment } from '../types/domain';
import './CollisionConfirm.css';

/**
 * CollisionConfirm — P1 Feature
 *
 * When two fragments collide in LimboHall, this overlay appears
 * asking the user to confirm whether they want to send a FateCard
 * to the other person. Both parties must confirm for matching to proceed.
 */

export interface CollisionConfirmProps {
  visible: boolean;
  selfFragment: LimboUserFragment;
  otherFragment: LimboUserFragment;
  onConfirm: () => void;
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 8000;

export const CollisionConfirm: React.FC<CollisionConfirmProps> = ({
  visible,
  selfFragment,
  otherFragment,
  onConfirm,
  onDismiss,
}) => {
  const [countdown, setCountdown] = useState(8);

  useEffect(() => {
    if (!visible) {
      setCountdown(8);
      return;
    }

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          onDismiss();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // Vibrate on appearance
    Taro.vibrateShort({ type: 'medium' }).catch(() => undefined);

    return () => clearInterval(timer);
  }, [visible, onDismiss]);

  const handleConfirm = useCallback(() => {
    Taro.vibrateShort({ type: 'heavy' }).catch(() => undefined);
    onConfirm();
  }, [onConfirm]);

  if (!visible) return null;

  return (
    <View className='collision-confirm'>
      <View className='collision-confirm__backdrop' onClick={onDismiss} />
      <View className='collision-confirm__panel'>
        <View className='collision-confirm__header'>
          <Text className='collision-confirm__title'>命运碰撞</Text>
          <Text className='collision-confirm__countdown'>{countdown}s</Text>
        </View>

        <View className='collision-confirm__bodies'>
          <View className='collision-confirm__body collision-confirm__body--self'>
            <Text className='collision-confirm__body-name'>{selfFragment.displayName}</Text>
          </View>
          <Text className='collision-confirm__collision-icon'>⟷</Text>
          <View className='collision-confirm__body collision-confirm__body--other'>
            <Text className='collision-confirm__body-name'>{otherFragment.displayName}</Text>
          </View>
        </View>

        <Text className='collision-confirm__question'>
          是否向 TA 递出命运卡片？
        </Text>

        <View className='collision-confirm__actions'>
          <Button className='collision-confirm__btn collision-confirm__btn--confirm' onClick={handleConfirm}>
            递出卡片
          </Button>
          <Button className='collision-confirm__btn collision-confirm__btn--dismiss' onClick={onDismiss}>
            擦肩而过
          </Button>
        </View>

        <Text className='collision-confirm__hint'>
          双方都确认后才会进入 FateCard 环节
        </Text>
      </View>
    </View>
  );
};

export default CollisionConfirm;
