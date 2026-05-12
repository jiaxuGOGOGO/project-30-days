import React, { useCallback, useEffect, useRef, useState } from 'react';
import Taro from '@tarojs/taro';
import { Button, Canvas, Text, View } from '@tarojs/components';
import './LegacyTicketCanvas.css';

const CANVAS_ID = 'legacy-ticket-canvas';
const CANVAS_WIDTH = 686;
const CANVAS_HEIGHT = 980;

interface LegacyTicketCanvasProps {
  msgCount: number;
  connectionAlias?: string;
  visible?: boolean;
  onExport?: (path: string) => void;
}

interface CanvasContext2DLike {
  fillStyle: string;
  strokeStyle: string;
  font: string;
  textAlign: 'left' | 'center' | 'right';
  textBaseline: 'top' | 'middle' | 'bottom' | 'alphabetic';
  lineWidth: number;
  setLineDash?: (segments: number[]) => void;
  scale: (x: number, y: number) => void;
  fillRect: (x: number, y: number, width: number, height: number) => void;
  strokeRect: (x: number, y: number, width: number, height: number) => void;
  beginPath: () => void;
  moveTo: (x: number, y: number) => void;
  lineTo: (x: number, y: number) => void;
  stroke: () => void;
  fillText: (text: string, x: number, y: number) => void;
  measureText: (text: string) => { width: number };
  save: () => void;
  restore: () => void;
  translate: (x: number, y: number) => void;
  rotate: (angle: number) => void;
}

interface CanvasNodeLike {
  width: number;
  height: number;
  getContext: (type: '2d') => CanvasContext2DLike;
}

interface SelectorNodeResult {
  node?: CanvasNodeLike;
  width?: number;
  height?: number;
}

const ticketCopy = (msgCount: number): string => (
  `在这场30天的实验中，你们交换了 ${msgCount} 次灵魂回响。但在最后关头，钥匙化为了灰烬。`
);

const wrapText = (ctx: CanvasContext2DLike, text: string, maxWidth: number): string[] => {
  const lines: string[] = [];
  let current = '';
  Array.from(text).forEach((char) => {
    const next = `${current}${char}`;
    if (ctx.measureText(next).width > maxWidth && current.length > 0) {
      lines.push(current);
      current = char;
      return;
    }
    current = next;
  });
  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
};

// 🛠️ 修复：增加 setTimeout 重试机制，防止 visible 刚变为 true 时原生 Canvas 节点尚未挂载导致空指针
const queryCanvasNode = (retryCount = 0): Promise<CanvasNodeLike> => new Promise((resolve, reject) => {
  setTimeout(() => {
    const query = Taro.createSelectorQuery();
    const nodeRef = query.select(`#${CANVAS_ID}`) as any;

    nodeRef.fields({ node: true, size: true }).exec((result) => {
      const canvas = result?.[0]?.node;
      if (canvas) {
        resolve(canvas);
      } else if (retryCount < 5) {
        queryCanvasNode(retryCount + 1).then(resolve).catch(reject); // 递归重试
      } else {
        reject(new Error('Legacy ticket canvas node rendering timeout.'));
      }
    });
  }, 100); // 给小程序原生渲染预留时间
});

export const LegacyTicketCanvas: React.FC<LegacyTicketCanvasProps> = ({
  msgCount,
  connectionAlias = 'UNKNOWN CONNECTION',
  visible = true,
  onExport
}) => {
  const canvasRef = useRef<CanvasNodeLike | null>(null);
  const [exporting, setExporting] = useState(false);
  const [lastPath, setLastPath] = useState('');

  const drawTicket = useCallback(async () => {
    const canvas = await queryCanvasNode();
    canvasRef.current = canvas;

    const systemInfo = Taro.getSystemInfoSync();
    const pixelRatio = Math.max(1, systemInfo.pixelRatio || 1);
    canvas.width = CANVAS_WIDTH * pixelRatio;
    canvas.height = CANVAS_HEIGHT * pixelRatio;

    const ctx = canvas.getContext('2d');
    ctx.scale(pixelRatio, pixelRatio);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.strokeRect(30, 30, CANVAS_WIDTH - 60, CANVAS_HEIGHT - 60);
    ctx.setLineDash?.([18, 18]);
    ctx.lineWidth = 2;
    ctx.strokeRect(58, 58, CANVAS_WIDTH - 116, CANVAS_HEIGHT - 116);
    ctx.setLineDash?.([]);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText('PROJECT 30-DAYS', CANVAS_WIDTH / 2, 92);
    ctx.font = 'bold 52px sans-serif';
    ctx.fillText('STARDUST TICKET', CANVAS_WIDTH / 2, 150);

    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    ctx.moveTo(92, 246);
    ctx.lineTo(CANVAS_WIDTH - 92, 246);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText('ROUTE', 92, 292);
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText('DAY 01  →  DAY 30', 92, 330);

    ctx.font = 'bold 24px sans-serif';
    ctx.fillText('PAIR', 92, 398);
    ctx.font = '28px sans-serif';
    ctx.fillText(connectionAlias.toUpperCase(), 92, 436);

    ctx.font = 'bold 24px sans-serif';
    ctx.fillText('FINAL VERDICT', 92, 506);
    ctx.font = 'bold 42px sans-serif';
    ctx.fillText('KEYS TURNED TO ASH', 92, 548);

    ctx.font = '30px sans-serif';
    const lines = wrapText(ctx, ticketCopy(msgCount), CANVAS_WIDTH - 184);
    lines.forEach((line, index) => {
      ctx.fillText(line, 92, 642 + index * 48);
    });

    ctx.save();
    ctx.translate(CANVAS_WIDTH - 118, CANVAS_HEIGHT - 142);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('LEGACY CANVAS · NO DOM', 0, 0);
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.font = '22px sans-serif';
    ctx.fillText('SHARE THIS AS THE PROOF OF A VANISHED ORBIT', CANVAS_WIDTH / 2, CANVAS_HEIGHT - 108);
  }, [connectionAlias, msgCount]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    drawTicket().catch(() => undefined);
  }, [drawTicket, visible]);

  const exportAndShare = useCallback(async () => {
    if (!visible) {
      return;
    }
    setExporting(true);
    try {
      const canvas = canvasRef.current ?? await queryCanvasNode();
      canvasRef.current = canvas;

      // 🛠️ 修复：强制等待 200 毫秒，确保微信底层的 Native Canvas 绘图指令全部推入 GPU 完成渲染
      await new Promise(resolve => setTimeout(resolve, 200));

      const result = await Taro.canvasToTempFilePath({
        canvas: canvas as unknown as Taro.Canvas,
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        destWidth: CANVAS_WIDTH * 2,
        destHeight: CANVAS_HEIGHT * 2,
        fileType: 'png',
        quality: 1
      });
      setLastPath(result.tempFilePath);
      onExport?.(result.tempFilePath);
      await Taro.showShareImageMenu({ path: result.tempFilePath });
    } catch (error) {
      await Taro.showToast({
        title: 'Ticket export failed',
        icon: 'none',
        duration: 1600
      });
    } finally {
      setExporting(false);
    }
  }, [onExport, visible]);

  if (!visible) {
    return null;
  }

  return (
    <View className='legacy-ticket'>
      <View className='legacy-ticket__header'>
        <Text className='legacy-ticket__eyebrow'>PHASE 4 · LEGACY CANVAS</Text>
        <Text className='legacy-ticket__title'>星尘车票</Text>
        <Text className='legacy-ticket__copy'>{ticketCopy(msgCount)}</Text>
      </View>
      <Canvas
        id={CANVAS_ID}
        canvasId={CANVAS_ID}
        type='2d'
        className='legacy-ticket__canvas'
      />
      <Button className='legacy-ticket__button' loading={exporting} onClick={exportAndShare}>
        {exporting ? 'EXPORTING STARDUST...' : 'EXPORT & SHARE IMAGE'}
      </Button>
      {lastPath ? <Text className='legacy-ticket__path'>Local ticket path: {lastPath}</Text> : null}
    </View>
  );
};
