import React, { useCallback, useState } from 'react';
import Taro from '@tarojs/taro';
import { Button, Text, View } from '@tarojs/components';
import { Day30Judgment } from '../../components/Day30Judgment';
import { useSessionStore } from '../../store/session';
import type { Day30JudgmentResult } from '../../types/domain';
import './index.css';

const DAY30_CONNECTION_ID = 'demo-day30-connection';
const MESSAGE_COUNT = 347;

const Day30Page: React.FC = () => {
  const { currentUserId } = useSessionStore();
  const [lastResult, setLastResult] = useState<Day30JudgmentResult | null>(null);

  const backToHall = useCallback(() => {
    Taro.navigateBack().catch(() => {
      Taro.switchTab({ url: '/pages/index/index' }).catch(() => undefined);
    });
  }, []);

  return (
    <View className='day30-page'>
      <View className='day30-page__hero'>
        <Text className='day30-page__eyebrow'>DAY 30 · CLIMAX & LEGACY CANVAS</Text>
        <Text className='day30-page__title'>The Last Two Seconds</Text>
        <Text className='day30-page__copy'>
          This page keeps the whole interaction inside Taro components and WeChat Mini Program Canvas 2D. No DOM Canvas is used.
        </Text>
      </View>

      <Day30Judgment
        connectionId={DAY30_CONNECTION_ID}
        userId={currentUserId}
        msgCount={MESSAGE_COUNT}
        submitUrl='/api/day30/judgment'
        connectionAlias='VOID-01 × UNKNOWN'
        onSubmitted={setLastResult}
      />

      {lastResult ? (
        <View className='day30-page__summary'>
          <Text className='day30-page__summary-title'>Latest local terminal state</Text>
          <Text className='day30-page__summary-copy'>Outcome: {lastResult.outcome}</Text>
          <Text className='day30-page__summary-copy'>Ticket: {lastResult.ticketPath || 'not exported yet'}</Text>
        </View>
      ) : null}

      <Button className='day30-page__button' onClick={backToHall}>BACK TO LIMBO HALL</Button>
    </View>
  );
};

export default Day30Page;
