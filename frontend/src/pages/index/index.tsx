import React, { useCallback } from 'react';
import Taro from '@tarojs/taro';
import { Button, Text, View } from '@tarojs/components';
import { GatingVideo } from '../../components/GatingVideo';
import { LimboHall } from '../../components/LimboHall';
import { useSessionStore } from '../../store/session';
import type { LimboUserFragment, UserRole } from '../../types/domain';
import './index.css';

const SAMPLE_VIDEO = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';

const nextRole = (role: UserRole): UserRole => (role === 'ACTIVE' ? 'WATCHER' : 'ACTIVE');

const IndexPage: React.FC = () => {
  const { currentUserId, currentRole, connectedDays, fragments, setRole, setConnectedDays, setFragments } = useSessionStore();

  const handleFragmentTap = useCallback((fragment: LimboUserFragment) => {
    Taro.showToast({
      title: fragment.role === 'WATCHER' ? `${fragment.displayName} is only watching` : `${fragment.displayName} selected`,
      icon: 'none',
      duration: 1300
    }).catch(() => undefined);
  }, []);

  const toggleGhostState = useCallback(() => {
    const role = nextRole(currentRole);
    setRole(role);
    setFragments(
      fragments.map((fragment) => (
        fragment.id === currentUserId
          ? { ...fragment, role, firePoints: role === 'WATCHER' ? 0 : Math.max(1, fragment.firePoints) }
          : fragment
      ))
    );
  }, [currentRole, currentUserId, fragments, setFragments, setRole]);

  return (
    <View className='phase3-page'>
      <View className='phase3-page__hero'>
        <Text className='phase3-page__eyebrow'>PHASE 3 · FRONTEND PHYSICS HALL</Text>
        <Text className='phase3-page__title'>30-Days Limbo</Text>
        <Text className='phase3-page__copy'>
          Taro 3 + React components only. No window, document, native div, or browser canvas access.
        </Text>
      </View>

      <View className='phase3-page__controls'>
        <Button className='phase3-page__button' onClick={toggleGhostState}>
          Toggle Current Role: {currentRole}
        </Button>
        <Button className='phase3-page__button' onClick={() => setConnectedDays(connectedDays >= 30 ? 1 : connectedDays + 1)}>
          Advance Reveal Day: {connectedDays}
        </Button>
        <Button className='phase3-page__button' onClick={() => Taro.navigateTo({ url: '/pages/day30/index' })}>
          Enter Day 30 Judgment
        </Button>
      </View>

      <LimboHall
        fragments={fragments}
        currentUserId={currentUserId}
        heightPx={620}
        onFragmentTap={handleFragmentTap}
      />

      <GatingVideo
        src={SAMPLE_VIDEO}
        connectedDays={connectedDays}
        title='Connected Shadow'
        autoplay={false}
        muted
        controls
      />
    </View>
  );
};

export default IndexPage;
