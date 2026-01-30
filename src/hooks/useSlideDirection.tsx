import { useEffect, useRef, useState } from 'react';

export function useSlideDirection() {
  const [currentDirection, setCurrentDirection] = useState<'forward' | 'backward'>('forward');
  const previousDirectionRef = useRef<'forward' | 'backward'>('forward');

  const setDirection = (direction: 'forward' | 'backward') => {
    previousDirectionRef.current = currentDirection;
    setCurrentDirection(direction);
  };

  return {
    enterDirection: currentDirection,
    exitDirection: previousDirectionRef.current,
    setDirection
  };
}