import React, { useCallback, useEffect, useState } from 'react';
import Taro from '@tarojs/taro';
import { Button, Text, View } from '@tarojs/components';
import type { BoardingStatus } from '../../types/domain';
import './index.css';

/**
 * Boarding Hall Page — P1 Cold Start Strategy
 *
 * Users wait here before the room "departs".
 * Shows real-time count of waiting users and countdown to departure.
 * Creates anticipation and ensures minimum social density.
 */

const API_BASE = process.env.TARO_APP_API_BASE || '';

const BoardingPage: React.FC = () => {
  const [status, setStatus] = useState<BoardingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [countdown, setCountdown] = useState('');

  const fetchStatus = useCallback(async () => {
    try {
      const res = await Taro.request({
        url: `${API_BASE}/boarding/current`,
        method: 'GET',
      });
      if (res.statusCode === 200 && res.data) {
        setStatus(res.data as BoardingStatus);
      }
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
    const timer = setInterval(fetchStatus, 10000); // Poll every 10s
    return () => clearInterval(timer);
  }, [fetchStatus]);

  // Countdown timer
  useEffect(() => {
    if (!status?.scheduledAt) return;
    const updateCountdown = () => {
      const target = new Date(status.scheduledAt!).getTime();
      const now = Date.now();
      const diff = target - now;
      if (diff <= 0) {
        setCountdown('即将发车...');
        return;
      }
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      if (days > 0) {
        setCountdown(`${days}天 ${hours}时 ${minutes}分`);
      } else if (hours > 0) {
        setCountdown(`${hours}时 ${minutes}分`);
      } else {
        setCountdown(`${minutes}分钟`);
      }
    };
    updateCountdown();
    const timer = setInterval(updateCountdown, 60000);
    return () => clearInterval(timer);
  }, [status?.scheduledAt]);

  const handleJoin = useCallback(async () => {
    if (!status) return;
    setJoining(true);
    try {
      const res = await Taro.request({
        url: `${API_BASE}/boarding/join`,
        method: 'POST',
        data: { roomId: status.roomId },
      });
      if (res.statusCode === 200 || res.statusCode === 201) {
        setStatus(res.data as BoardingStatus);
        setJoined(true);
        await Taro.showToast({ title: '已加入候车队列', icon: 'success', duration: 1500 });
      }
    } catch {
      await Taro.showToast({ title: '加入失败', icon: 'none', duration: 1500 });
    } finally {
      setJoining(false);
    }
  }, [status]);

  if (loading) {
    return (
      <View className='boarding-page'>
        <View className='boarding-page__loading'>
          <Text className='boarding-page__loading-text'>正在连接候车大厅...</Text>
        </View>
      </View>
    );
  }

  const progress = status ? Math.min(100, Math.round((status.currentCount / status.minUsers) * 100)) : 0;

  return (
    <View className='boarding-page'>
      <View className='boarding-page__header'>
        <Text className='boarding-page__eyebrow'>BOARDING HALL</Text>
        <Text className='boarding-page__title'>候车大厅</Text>
        <Text className='boarding-page__subtitle'>等待命运列车发车</Text>
      </View>

      <View className='boarding-page__stats'>
        <View className='boarding-page__stat-item'>
          <Text className='boarding-page__stat-value'>{status?.currentCount ?? 0}</Text>
          <Text className='boarding-page__stat-label'>当前候车人数</Text>
        </View>
        <View className='boarding-page__stat-divider' />
        <View className='boarding-page__stat-item'>
          <Text className='boarding-page__stat-value'>{status?.minUsers ?? 50}</Text>
          <Text className='boarding-page__stat-label'>最低发车人数</Text>
        </View>
        <View className='boarding-page__stat-divider' />
        <View className='boarding-page__stat-item'>
          <Text className='boarding-page__stat-value'>{countdown || '--'}</Text>
          <Text className='boarding-page__stat-label'>距离发车</Text>
        </View>
      </View>

      <View className='boarding-page__progress'>
        <View className='boarding-page__progress-bar' style={{ width: `${progress}%` }} />
      </View>
      <Text className='boarding-page__progress-text'>
        {status?.estimatedWaitMessage ?? '加载中...'}
      </Text>

      <View className='boarding-page__action'>
        {joined ? (
          <View className='boarding-page__joined'>
            <Text className='boarding-page__joined-text'>已加入候车队列</Text>
            <Text className='boarding-page__joined-hint'>
              发车后你将自动进入 30 天旅程。请保持通知开启。
            </Text>
          </View>
        ) : (
          <Button
            className='boarding-page__join-btn'
            onClick={handleJoin}
            loading={joining}
            disabled={joining}
          >
            {joining ? '加入中...' : '加入候车队列'}
          </Button>
        )}
      </View>

      <View className='boarding-page__info'>
        <Text className='boarding-page__info-title'>候车规则</Text>
        <Text className='boarding-page__info-item'>• 达到最低人数后立即发车</Text>
        <Text className='boarding-page__info-item'>• 或在预定时间（每周五 20:00）强制发车</Text>
        <Text className='boarding-page__info-item'>• 发车后 30 天倒计时正式开始</Text>
        <Text className='boarding-page__info-item'>• 候车期间可以看到其他等待的人</Text>
      </View>
    </View>
  );
};

export default BoardingPage;
