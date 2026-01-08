'use client';

import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

interface WaveformVisualizerProps {
  analyserNode: AnalyserNode | null;
  isRecording: boolean;
  className?: string;
  compact?: boolean;
}

export function WaveformVisualizer({
  analyserNode,
  isRecording,
  className = '',
  compact = false,
}: WaveformVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!analyserNode || !canvasRef.current || !isRecording) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Use fewer, thinner bars for a cleaner look
    const numBars = compact ? 32 : 48;
    const dataArray = new Uint8Array(analyserNode.frequencyBinCount);

    const draw = () => {
      if (!isRecording) return;

      animationRef.current = requestAnimationFrame(draw);
      analyserNode.getByteFrequencyData(dataArray);

      // Clear with transparent background
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Calculate bar dimensions
      const gap = 2;
      const barWidth = (canvas.width - (numBars - 1) * gap) / numBars;
      const centerY = canvas.height / 2;

      // Sample the frequency data at regular intervals
      const step = Math.floor(dataArray.length / numBars);

      for (let i = 0; i < numBars; i++) {
        // Get amplitude from frequency data
        const dataIndex = i * step;
        const amplitude = dataArray[dataIndex] / 255;
        
        // Add some smoothing with neighboring values
        const prev = dataIndex > 0 ? dataArray[dataIndex - step] / 255 : amplitude;
        const next = dataIndex < dataArray.length - step ? dataArray[dataIndex + step] / 255 : amplitude;
        const smoothedAmplitude = (prev + amplitude * 2 + next) / 4;

        // Calculate bar height (minimum height for visual appeal)
        const minHeight = 4;
        const maxHeight = canvas.height * 0.85;
        const barHeight = Math.max(minHeight, smoothedAmplitude * maxHeight);

        const x = i * (barWidth + gap);
        const y = centerY - barHeight / 2;

        // Create gradient for each bar
        const gradient = ctx.createLinearGradient(x, y + barHeight, x, y);
        gradient.addColorStop(0, '#06b6d4');   // Cyan
        gradient.addColorStop(0.5, '#8b5cf6'); // Purple
        gradient.addColorStop(1, '#c084fc');   // Light purple

        ctx.fillStyle = gradient;

        // Draw rounded rectangle bar
        const radius = Math.min(barWidth / 2, 2);
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, radius);
        ctx.fill();
      }
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [analyserNode, isRecording, compact]);

  const height = compact ? 40 : 60;

  return (
    <motion.div
      initial={{ opacity: 0, scaleY: 0.8 }}
      animate={{ opacity: 1, scaleY: 1 }}
      exit={{ opacity: 0, scaleY: 0.8 }}
      className={`relative overflow-hidden ${className}`}
    >
      <canvas
        ref={canvasRef}
        width={compact ? 200 : 280}
        height={height}
        className="w-full"
        style={{ height: `${height}px` }}
      />
    </motion.div>
  );
}
