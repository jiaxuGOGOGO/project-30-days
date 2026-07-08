import React, { useCallback, useEffect, useState } from 'react';
import Taro from '@tarojs/taro';
import { Button, Text, Textarea, View } from '@tarojs/components';
import { useSessionStore } from '../../store/session';
import type { DailyEchoPrompt } from '../../types/domain';
import './index.css';

/**
 * DailyEcho Page — P1 Feature
 *
 * Displays the daily double-blind question and allows users to submit answers.
 * Both users must answer before they can see each other's response.
 * Video reveal progress only advances when both answer.
 */

const API_BASE = process.env.TARO_APP_API_BASE || '';

const DailyEchoPage: React.FC = () => {
  const { currentUserId } = useSessionStore();
  const [echo, setEcho] = useState<DailyEchoPrompt | null>(null);
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [connectionId] = useState('00000000-0000-4000-8000-000000000010'); // TODO: from route params

  const fetchCurrentEcho = useCallback(async () => {
    setLoading(true);
    try {
      const res = await Taro.request({
        url: `${API_BASE}/daily-echo/current/${connectionId}?userId=${currentUserId}`,
        method: 'GET',
      });
      if (res.statusCode === 200 && res.data) {
        setEcho(res.data as DailyEchoPrompt);
      }
    } catch {
      // Silent fail in dev
    } finally {
      setLoading(false);
    }
  }, [connectionId, currentUserId]);

  useEffect(() => {
    void fetchCurrentEcho();
  }, [fetchCurrentEcho]);

  const handleSubmit = useCallback(async () => {
    if (!answer.trim() || !echo) return;
    setSubmitting(true);
    try {
      const res = await Taro.request({
        url: `${API_BASE}/daily-echo/answer`,
        method: 'POST',
        data: {
          connectionId,
          userId: currentUserId,
          dayNumber: echo.dayNumber,
          answer: answer.trim(),
        },
      });
      if (res.statusCode === 200 || res.statusCode === 201) {
        setEcho(res.data as DailyEchoPrompt);
        setAnswer('');
        await Taro.showToast({ title: '回答已提交', icon: 'success', duration: 1500 });
      }
    } catch {
      await Taro.showToast({ title: '提交失败', icon: 'none', duration: 1500 });
    } finally {
      setSubmitting(false);
    }
  }, [answer, connectionId, currentUserId, echo]);

  if (loading) {
    return (
      <View className='echo-page'>
        <View className='echo-page__loading'>
          <Text className='echo-page__loading-text'>正在加载今日回响...</Text>
        </View>
      </View>
    );
  }

  if (!echo) {
    return (
      <View className='echo-page'>
        <View className='echo-page__empty'>
          <Text className='echo-page__empty-title'>今日回响尚未生成</Text>
          <Text className='echo-page__empty-hint'>每晚 20:00 系统会推送新的问题</Text>
        </View>
      </View>
    );
  }

  return (
    <View className='echo-page'>
      <View className='echo-page__header'>
        <Text className='echo-page__eyebrow'>DAILY ECHO · DAY {echo.dayNumber}</Text>
        <Text className='echo-page__title'>每日回响</Text>
      </View>

      <View className='echo-page__prompt'>
        <Text className='echo-page__prompt-text'>{echo.promptText}</Text>
      </View>

      {echo.myAnswer ? (
        <View className='echo-page__answered'>
          <View className='echo-page__my-answer'>
            <Text className='echo-page__answer-label'>我的回答</Text>
            <Text className='echo-page__answer-text'>{echo.myAnswer}</Text>
          </View>

          {echo.bothAnswered && echo.partnerAnswer ? (
            <View className='echo-page__partner-answer'>
              <Text className='echo-page__answer-label'>TA 的回答</Text>
              <Text className='echo-page__answer-text'>{echo.partnerAnswer}</Text>
              <Text className='echo-page__reveal-hint'>视频揭示进度 +1</Text>
            </View>
          ) : (
            <View className='echo-page__waiting'>
              <Text className='echo-page__waiting-text'>等待对方回答后，即可看到 TA 的答案...</Text>
              <Text className='echo-page__waiting-hint'>双方都回答后，视频揭示才会推进</Text>
            </View>
          )}
        </View>
      ) : (
        <View className='echo-page__input-area'>
          <Textarea
            className='echo-page__textarea'
            value={answer}
            onInput={(e) => setAnswer(e.detail.value)}
            placeholder='写下你的回答（1-500字）...'
            maxlength={500}
            autoHeight
          />
          <Text className='echo-page__char-count'>{answer.length}/500</Text>
          <Button
            className='echo-page__submit-btn'
            onClick={handleSubmit}
            loading={submitting}
            disabled={!answer.trim() || submitting}
          >
            {submitting ? '提交中...' : '提交回答'}
          </Button>
          <Text className='echo-page__submit-hint'>
            提交后不可修改。双方都回答后才能看到对方的答案。
          </Text>
        </View>
      )}
    </View>
  );
};

export default DailyEchoPage;
