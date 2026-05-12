import React, { useCallback, useEffect, useRef, useState } from 'react';
import Taro from '@tarojs/taro';
import { Button, Text, View } from '@tarojs/components';
import { LegacyTicketCanvas } from './LegacyTicketCanvas';
import type { Day30Choice, Day30JudgmentPayload, Day30JudgmentResult } from '../types/domain';
import './Day30Judgment.css';

const HOLD_REQUIRED_MS = 2000;
const HEARTBEAT_MS = 150;

interface Day30JudgmentProps {
  connectionId: string;
  userId: string;
  msgCount: number;
  submitUrl?: string;
  connectionAlias?: string;
  /** 开发态调试钩子：传入对方决策后，本地直接结算，不请求后端。 */
  debugCounterpartDecision?: Day30Choice;
  onSubmitted?: (result: Day30JudgmentResult) => void;
}

interface JudgmentApiResponse {
  outcome?: Day30JudgmentResult['outcome'];
  msgCount?: number;
  ticketTitle?: string;
}

interface ChoiceMeta {
  choice: Day30Choice;
  label: string;
  subtitle: string;
  warning: string;
}

const CHOICES: ChoiceMeta[] = [
  {
    choice: 'DEFECT',
    label: '保留防御 DEFECT',
    subtitle: 'Keep the last wall standing.',
    warning: 'This preserves the armor, but may turn the shared key into ash.'
  },
  {
    choice: 'COOPERATE',
    label: '交出钥匙 COOPERATE',
    subtitle: 'Hand over the final key.',
    warning: 'This removes the final defense and asks the other side to do the same.'
  }
];

const clampProgress = (heldMs: number): number => Math.min(100, Math.max(0, Math.round((heldMs / HOLD_REQUIRED_MS) * 100)));

export const Day30Judgment: React.FC<Day30JudgmentProps> = ({
  connectionId,
  userId,
  msgCount,
  submitUrl = '/api/day30/judgment',
  connectionAlias = 'DAY30 PAIR',
  debugCounterpartDecision,
  onSubmitted
}) => {
  const [activeChoice, setActiveChoice] = useState<Day30Choice | null>(null);
  const [heldMs, setHeldMs] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Day30JudgmentResult | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef(0);
  const completedRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const submitChoice = useCallback(async (choice: Day30Choice) => {
    if (submitting) {
      return;
    }
    setSubmitting(true);
    const payload: Day30JudgmentPayload = {
      connectionId,
      userId,
      choice,
      heldMs: HOLD_REQUIRED_MS
    };

    try {
      if (debugCounterpartDecision) {
        const nextResult: Day30JudgmentResult = {
          outcome: choice === 'COOPERATE' && debugCounterpartDecision === 'COOPERATE' ? 'LEGACY' : 'ASH',
          msgCount,
          ticketTitle: choice === 'COOPERATE' && debugCounterpartDecision === 'COOPERATE'
            ? 'Mutual Key Legacy'
            : 'Single-Sided Ash Ticket'
        };
        setResult(nextResult);
        onSubmitted?.(nextResult);
        await Taro.showToast({
          title: `Debug outcome: ${nextResult.outcome}`,
          icon: 'none',
          duration: 1500
        });
        return;
      }

      const response = await Taro.request<JudgmentApiResponse>({
        url: submitUrl,
        method: 'POST',
        data: payload,
        header: {
          'content-type': 'application/json'
        }
      });
      const nextResult: Day30JudgmentResult = {
        outcome: response.data?.outcome ?? (choice === 'COOPERATE' ? 'LEGACY' : 'ASH'),
        msgCount: response.data?.msgCount ?? msgCount,
        ticketTitle: response.data?.ticketTitle
      };
      setResult(nextResult);
      onSubmitted?.(nextResult);
      await Taro.showToast({
        title: nextResult.outcome === 'ASH' ? 'Key turned to ash' : 'Legacy unlocked',
        icon: 'none',
        duration: 1500
      });
    } catch (error) {
      const fallbackResult: Day30JudgmentResult = {
        outcome: choice === 'DEFECT' ? 'ASH' : 'PENDING',
        msgCount
      };
      setResult(fallbackResult);
      onSubmitted?.(fallbackResult);
      await Taro.showToast({
        title: 'Judgment submitted locally',
        icon: 'none',
        duration: 1500
      });
    } finally {
      setSubmitting(false);
      completedRef.current = false;
      setActiveChoice(null);
      setHeldMs(0);
    }
  }, [connectionId, debugCounterpartDecision, msgCount, onSubmitted, submitUrl, submitting, userId]);

  const startHold = useCallback((choice: Day30Choice) => {
    if (submitting) {
      return;
    }
    clearTimers();
    completedRef.current = false;
    startedAtRef.current = Date.now();
    setActiveChoice(choice);
    setHeldMs(0);

    Taro.vibrateShort({ type: 'heavy' }).catch(() => undefined);
    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAtRef.current;
      setHeldMs(Math.min(HOLD_REQUIRED_MS, elapsed));
      Taro.vibrateShort({ type: 'heavy' }).catch(() => undefined);
    }, HEARTBEAT_MS);

    timeoutRef.current = setTimeout(() => {
      completedRef.current = true;
      clearTimers();
      setHeldMs(HOLD_REQUIRED_MS);
      submitChoice(choice).catch(() => undefined);
    }, HOLD_REQUIRED_MS);
  }, [clearTimers, submitChoice, submitting]);

  const abortHold = useCallback(() => {
    if (completedRef.current) {
      return;
    }
    clearTimers();
    if (activeChoice) {
      Taro.showToast({
        title: 'Hold interrupted',
        icon: 'none',
        duration: 900
      }).catch(() => undefined);
    }
    setActiveChoice(null);
    setHeldMs(0);
  }, [activeChoice, clearTimers]);

  const progress = clampProgress(heldMs);
  const needsTicket = result?.outcome === 'ASH';

  return (
    <View className='day30-judgment'>
      <View className='day30-judgment__header'>
        <Text className='day30-judgment__eyebrow'>PHASE 4 · DAY 30 CLIMAX</Text>
        <Text className='day30-judgment__title'>Final Key Judgment</Text>
        <Text className='day30-judgment__copy'>
          Touch must be intentional. Hold either decision for a full 2000ms; releasing immediately cancels the timer.
        </Text>
      </View>

      <View className='day30-judgment__choices'>
        {CHOICES.map((item) => {
          const isActive = activeChoice === item.choice;
          return (
            <View
              key={item.choice}
              className={`day30-judgment__choice ${isActive ? 'day30-judgment__choice--active' : ''}`}
              // 🛠️ 修复：增加 stopPropagation 阻止事件击穿，防止系统长按菜单打断倒计时
              onTouchStart={(e) => { e.stopPropagation(); startHold(item.choice); }}
              onTouchEnd={(e) => { e.stopPropagation(); abortHold(); }}
              onTouchCancel={(e) => { e.stopPropagation(); abortHold(); }}
            >
              <Text className='day30-judgment__choice-label'>{item.label}</Text>
              <Text className='day30-judgment__choice-subtitle'>{item.subtitle}</Text>
              <Text className='day30-judgment__choice-warning'>{item.warning}</Text>
              <View className='day30-judgment__progress-track'>
                <View className='day30-judgment__progress-fill' style={{ width: `${isActive ? progress : 0}%` }} />
              </View>
              <Text className='day30-judgment__hold-copy'>
                {isActive ? `${Math.max(0, HOLD_REQUIRED_MS - heldMs)}ms remaining` : 'PRESS AND HOLD FOR 2000ms'}
              </Text>
            </View>
          );
        })}
      </View>

      {submitting ? <Text className='day30-judgment__status'>Submitting final judgment to API...</Text> : null}
      {result ? (
        <View className='day30-judgment__result'>
          <Text className='day30-judgment__result-title'>Outcome: {result.outcome}</Text>
          <Text className='day30-judgment__result-copy'>Soul echoes counted: {result.msgCount}</Text>
        </View>
      ) : null}

      {needsTicket ? (
        <LegacyTicketCanvas
          msgCount={result.msgCount}
          connectionAlias={connectionAlias}
          visible={needsTicket}
          onExport={(ticketPath) => setResult({ ...result, ticketPath })}
        />
      ) : null}

      <Button className='day30-judgment__reset' onClick={() => setResult(null)}>
        RESET LOCAL JUDGMENT
      </Button>
    </View>
  );
};
