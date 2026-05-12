import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import Taro from '@tarojs/taro';
import { Canvas, Text, View } from '@tarojs/components';
import Matter from 'matter-js';
import type { LimboUserFragment } from '../types/domain';
import './LimboHall.css';

type CanvasNode = {
  width: number;
  height: number;
  getContext: (contextId: '2d') => CanvasRenderingContext2D;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
};

type FragmentBody = Matter.Body & {
  plugin: {
    fragment: LimboUserFragment;
    radius: number;
    opacity: number;
  };
};

export interface LimboHallProps {
  fragments: LimboUserFragment[];
  currentUserId?: string;
  heightPx?: number;
  onFragmentTap?: (fragment: LimboUserFragment) => void;
}

const CANVAS_ID = 'limbo-hall-canvas';
const DEFAULT_HEIGHT = 620;
const MAX_GRAVITY = 0.85;
const COLLISION_VIBRATION_COOLDOWN_MS = 140;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const stableUnit = (seed: number): number => {
  const value = Math.sin(seed * 9301 + 49297) * 233280;
  return value - Math.floor(value);
};

const makeFallbackFragments = (): LimboUserFragment[] => [
  { id: 'limbo-fallback-1', displayName: 'SIGNAL-01', role: 'ACTIVE', firePoints: 3, tint: '#ffffff', seed: 7 },
  { id: 'limbo-fallback-2', displayName: 'GHOST-02', role: 'WATCHER', firePoints: 0, tint: '#94a3b8', seed: 19 },
  { id: 'limbo-fallback-3', displayName: 'SIGNAL-03', role: 'ACTIVE', firePoints: 2, tint: '#dbeafe', seed: 31 }
];

const resolveRuntimeSize = (canvasNode: CanvasNode | undefined, configuredHeight: number) => {
  const systemInfo = Taro.getSystemInfoSync();
  const pixelRatio = Math.max(1, systemInfo.pixelRatio || 1);
  const width = Math.max(320, canvasNode?.width || systemInfo.windowWidth || 375);
  const height = Math.max(360, configuredHeight || DEFAULT_HEIGHT);
  return { width, height, pixelRatio };
};

const createBodies = (fragments: LimboUserFragment[], width: number, height: number): FragmentBody[] => {
  return fragments.map((fragment, index) => {
    const seed = fragment.seed ?? index + 1;
    const radius = fragment.role === 'WATCHER' ? 30 : clamp(34 + fragment.firePoints * 5, 34, 58);
    const x = clamp(width * (0.16 + stableUnit(seed) * 0.68), radius + 8, width - radius - 8);
    const y = fragment.role === 'WATCHER'
      ? clamp(height * (0.66 + stableUnit(seed + 17) * 0.22), radius + 8, height - radius - 8)
      : clamp(height * (0.18 + stableUnit(seed + 29) * 0.62), radius + 8, height - radius - 8);

    const body = Matter.Bodies.circle(x, y, radius, {
      label: fragment.id,
      restitution: 0.94,
      friction: 0.015,
      frictionAir: fragment.role === 'WATCHER' ? 0.05 : 0.018,
      density: 0.0012 + fragment.firePoints * 0.0001,
      isSensor: fragment.role === 'WATCHER'
    }) as FragmentBody;

    body.plugin = {
      fragment,
      radius,
      opacity: fragment.role === 'WATCHER' ? 0.2 : 0.92
    };

    return body;
  });
};

const createWalls = (width: number, height: number): Matter.Body[] => {
  const thickness = 64;
  return [
    Matter.Bodies.rectangle(width / 2, -thickness / 2, width + thickness * 2, thickness, { isStatic: true }),
    Matter.Bodies.rectangle(width / 2, height + thickness / 2, width + thickness * 2, thickness, { isStatic: true }),
    Matter.Bodies.rectangle(-thickness / 2, height / 2, thickness, height + thickness * 2, { isStatic: true }),
    Matter.Bodies.rectangle(width + thickness / 2, height / 2, thickness, height + thickness * 2, { isStatic: true })
  ];
};

const drawBody = (ctx: CanvasRenderingContext2D, body: FragmentBody, currentUserId?: string) => {
  const { fragment, radius, opacity } = body.plugin;
  const isCurrent = currentUserId === fragment.id;
  const fill = fragment.tint || '#ffffff';

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.translate(body.position.x, body.position.y);
  ctx.rotate(body.angle);
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.shadowColor = fragment.role === 'WATCHER' ? 'rgba(148, 163, 184, 0.18)' : 'rgba(255, 255, 255, 0.42)';
  ctx.shadowBlur = fragment.role === 'WATCHER' ? 10 : 22;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = isCurrent ? 4 : 1.5;
  ctx.strokeStyle = isCurrent ? '#38bdf8' : 'rgba(255,255,255,0.45)';
  ctx.stroke();
  ctx.fillStyle = fragment.role === 'WATCHER' ? '#0f172a' : '#030712';
  ctx.font = '600 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(fragment.displayName.slice(0, 10), 0, -2);
  ctx.font = '500 10px sans-serif';
  ctx.fillText(fragment.role === 'WATCHER' ? 'GHOST' : `${fragment.firePoints}F`, 0, 13);
  ctx.restore();
};

const drawFrame = (ctx: CanvasRenderingContext2D, bodies: FragmentBody[], width: number, height: number, currentUserId?: string) => {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= width; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += 48) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();
  bodies.forEach((body) => drawBody(ctx, body, currentUserId));
};

export const LimboHall: React.FC<LimboHallProps> = ({
  fragments,
  currentUserId,
  heightPx = DEFAULT_HEIGHT,
  onFragmentTap
}) => {
  const engineRef = useRef<Matter.Engine | null>(null);
  const runnerRef = useRef<number | NodeJS.Timeout | null>(null);
  const canvasRef = useRef<CanvasNode | null>(null);
  const bodiesRef = useRef<FragmentBody[]>([]);
  const latestCollisionAtRef = useRef(0);
  const activeFragments = useMemo(() => (fragments.length > 0 ? fragments : makeFallbackFragments()), [fragments]);

  const stopLoop = useCallback(() => {
    const canvasNode = canvasRef.current;
    if (runnerRef.current !== null) {
      if (typeof runnerRef.current === 'number' && canvasNode?.cancelAnimationFrame) {
        canvasNode.cancelAnimationFrame(runnerRef.current);
      } else {
        clearInterval(runnerRef.current as NodeJS.Timeout);
      }
      runnerRef.current = null;
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let accelerometerHandler: Taro.onAccelerometerChange.Callback | null = null;

    const setup = () => {
      const query = Taro.createSelectorQuery();
      query
        .select(`#${CANVAS_ID}`)
        .fields({ node: true, size: true } as Taro.NodesRef.Fields, (res) => {
          if (disposed) {
            return;
          }

          const node = (res as unknown as { node?: CanvasNode }).node;
          canvasRef.current = node || null;
          const runtime = resolveRuntimeSize(node, heightPx);
          const width = runtime.width;
          const height = runtime.height;

          if (!node) {
            throw new Error('LimboHall requires Taro Canvas type="2d" node support in the current runtime.');
          }

          node.width = width * runtime.pixelRatio;
          node.height = height * runtime.pixelRatio;
          const ctx = node.getContext('2d');
          ctx.scale(runtime.pixelRatio, runtime.pixelRatio);

          const engine = Matter.Engine.create({ enableSleeping: false });
          engine.world.gravity.x = 0;
          engine.world.gravity.y = 0;
          engine.world.gravity.scale = 0.001;
          engineRef.current = engine;

          const bodies = createBodies(activeFragments, width, height);
          bodiesRef.current = bodies;
          Matter.Composite.add(engine.world, [...createWalls(width, height), ...bodies]);

          Matter.Events.on(engine, 'collisionStart', () => {
            const now = Date.now();
            if (now - latestCollisionAtRef.current > COLLISION_VIBRATION_COOLDOWN_MS) {
              latestCollisionAtRef.current = now;
              Taro.vibrateShort({ type: 'light' }).catch(() => undefined);
            }
          });

          accelerometerHandler = (res) => {
            const gravityX = clamp(res.x || 0, -1, 1) * MAX_GRAVITY;
            const gravityY = clamp(-(res.y || 0), -1, 1) * MAX_GRAVITY;
            engine.world.gravity.x = gravityX;
            engine.world.gravity.y = gravityY;
          };

          Taro.startAccelerometer({ interval: 'game' })
            .then(() => {
              if (accelerometerHandler) {
                Taro.onAccelerometerChange(accelerometerHandler);
              }
            })
            .catch(() => undefined);

          const tick = () => {
            if (disposed) {
              return;
            }
            Matter.Engine.update(engine, 1000 / 60);
            drawFrame(ctx, bodiesRef.current, width, height, currentUserId);
            if (node.requestAnimationFrame) {
              runnerRef.current = node.requestAnimationFrame(tick);
            }
          };

          if (node.requestAnimationFrame) {
            runnerRef.current = node.requestAnimationFrame(tick);
          } else {
            runnerRef.current = setInterval(tick, 1000 / 30);
          }
        })
        .exec();
    };

    setup();

    return () => {
      disposed = true;
      stopLoop();
      if (accelerometerHandler) {
        Taro.offAccelerometerChange(accelerometerHandler);
      }
      Taro.stopAccelerometer().catch(() => undefined);
      if (engineRef.current) {
        Matter.World.clear(engineRef.current.world, false);
        Matter.Engine.clear(engineRef.current);
      }
      engineRef.current = null;
      bodiesRef.current = [];
    };
  }, [activeFragments, currentUserId, heightPx, stopLoop]);

  const handleTap = useCallback((event: any) => {
    if (!onFragmentTap || !event) return;

    // 🛠️ 修复：完美兼容微信小程序与 Web 端的坐标数据结构
    const touch = event.changedTouches?.[0] || event.touches?.[0] || event.detail;
    const x = touch?.x ?? touch?.clientX;
    const y = touch?.y ?? touch?.clientY;

    if (typeof x !== 'number' || typeof y !== 'number') return;

    const target = bodiesRef.current.find((body) => {
      const distance = Math.hypot(body.position.x - x, body.position.y - y);
      // 🛠️ 修复：增加 15px 容错，防止手指太粗点不到精确半径
      return distance <= body.plugin.radius + 15;
    });

    if (target) {
      Taro.vibrateShort({ type: 'medium' }).catch(() => undefined);
      onFragmentTap(target.plugin.fragment);
    }
  }, [onFragmentTap]);

  return (
    <View className='limbo-hall' style={{ height: `${heightPx}px` }}>
      <View className='limbo-hall__hud'>
        <Text className='limbo-hall__title'>LIMBO HALL</Text>
        <Text className='limbo-hall__subtitle'>Tilt the device. Ghosts lose collision volume.</Text>
      </View>
      <Canvas
        id={CANVAS_ID}
        canvasId={CANVAS_ID}
        type='2d'
        disableScroll
        className='limbo-hall__canvas'
        style={{ height: `${heightPx}px` }}
        onTouchEnd={handleTap}
      />
    </View>
  );
};

export default LimboHall;
