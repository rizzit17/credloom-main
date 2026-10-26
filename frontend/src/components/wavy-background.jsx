"use client";
import { cn } from "@/lib/utils";
import React, { useEffect, useRef, useState } from "react";
import { createNoise3D } from "simplex-noise";

export const WavyBackground = ({
  children,
  className,
  containerClassName,
  colors,
  waveWidth,
  backgroundFill,
  blur = 10,
  speed = "fast",
  waveOpacity = 0.5,
  ...props
}) => {
  const noise = createNoise3D();
  const canvasRef = useRef(null);
  const containerRef = useRef(null); // Ref for the container div

  // State for Safari detection
  const [isSafari, setIsSafari] = useState(false);
  useEffect(() => {
    
  }, []);

  useEffect(() => {
    // Get canvas and container elements
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    let w, h, nt = 0;
    let animationId;

    const getSpeed = () => {
      switch (speed) {
        case "slow": return 0.001;
        case "fast": return 0.002;
        default: return 0.001;
      }
    };

    const waveColors = colors ?? [
      "#38bdf8", "#818cf8", "#c084fc", "#e879f9", "#22d3ee",
    ];

    const drawWave = (n) => {
      nt += getSpeed();
      for (let i = 0; i < n; i++) {
        ctx.beginPath();
        ctx.lineWidth = waveWidth || 50;
        ctx.strokeStyle = waveColors[i % waveColors.length];
        for (let x = 0; x < w; x += 5) {
          const y = noise(x / 800, 0.3 * i, nt) * 100;
          ctx.lineTo(x, y + h * 0.5);
        }
        ctx.stroke();
        ctx.closePath();
      }
    };

    const render = () => {
      ctx.fillStyle = backgroundFill || "black";
      ctx.globalAlpha = waveOpacity || 0.5;
      ctx.fillRect(0, 0, w, h);
      drawWave(5);
      animationId = requestAnimationFrame(render);
    };
    
    // This function will resize the canvas to fit its container
    const resizeCanvas = () => {
      w = ctx.canvas.width = container.offsetWidth;
      h = ctx.canvas.height = container.offsetHeight;
      ctx.filter = `blur(${blur}px)`;
    };

    // Use ResizeObserver to handle container resizing
    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(container);

    // Initial resize and render
    resizeCanvas();
    render();

    // Cleanup function
    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(animationId);
    };
  }, [backgroundFill, blur, colors, speed, waveOpacity, waveWidth]); // Re-run effect if props change

  return (
    <div
      // MODIFICATION: Added ref, relative, overflow-hidden and changed h-screen to h-full
      ref={containerRef}
      className={cn(
        "h-full w-full relative overflow-hidden flex flex-col items-center justify-center",
        containerClassName
      )}
    >
      <canvas
        className="absolute inset-0 z-0"
        ref={canvasRef}
        id="canvas"
        style={{
          ...(isSafari ? { filter: `blur(${blur}px)` } : {}),
        }}
      ></canvas>
      <div className={cn("relative z-10", className)} {...props}>
        {children}
      </div>
    </div>
  );
};