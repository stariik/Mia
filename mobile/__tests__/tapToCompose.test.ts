import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { useTapToCompose } from '@/components/chat/useTapToCompose';

// Tapping the conversation opens the text field — but only a real tap: not a
// scroll, not a long-press, not a tap on a button inside the list.

type Api = ReturnType<typeof useTapToCompose>;
const ev = (x: number, y: number) => ({ nativeEvent: { pageX: x, pageY: y } }) as never;

function mount(onTap: () => void): Api {
  let api!: Api;
  function Probe() {
    api = useTapToCompose(onTap);
    return null;
  }
  act(() => {
    TestRenderer.create(React.createElement(Probe));
  });
  return api;
}

describe('tap to compose', () => {
  beforeEach(() => jest.useFakeTimers({ now: 1_000_000 }));
  afterEach(() => jest.useRealTimers());

  it('a short, still touch opens the composer', () => {
    const onTap = jest.fn();
    const { touchProps } = mount(onTap);
    touchProps.onTouchStart(ev(100, 300));
    jest.advanceTimersByTime(120);
    touchProps.onTouchEnd(ev(103, 302));
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it('ignores a drag, a long-press and a tap that stops a fling', () => {
    const onTap = jest.fn();
    const { touchProps, noteScroll } = mount(onTap);
    touchProps.onTouchStart(ev(100, 300));
    touchProps.onTouchEnd(ev(100, 260)); // dragged
    touchProps.onTouchStart(ev(100, 300));
    jest.advanceTimersByTime(600);
    touchProps.onTouchEnd(ev(100, 300)); // long-press (copy)
    touchProps.onTouchStart(ev(100, 300));
    noteScroll(); // the touch caught a fling
    touchProps.onTouchEnd(ev(100, 300));
    expect(onTap).not.toHaveBeenCalled();
  });

  it('ignores taps on controls inside the list, once', () => {
    const onTap = jest.fn();
    const { touchProps, claim } = mount(onTap);
    touchProps.onTouchStart(ev(10, 10));
    claim();
    touchProps.onTouchEnd(ev(10, 10));
    expect(onTap).not.toHaveBeenCalled();
    touchProps.onTouchStart(ev(10, 10));
    touchProps.onTouchEnd(ev(10, 10));
    expect(onTap).toHaveBeenCalledTimes(1);
  });
});
