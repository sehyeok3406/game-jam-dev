import { useCanvasZoom } from './useCanvasZoom';
import { useId, useLayoutEffect, useRef } from 'react';
import { useStoreApi } from '@xyflow/react';

/** SVG hit widths need the outer CSS camera scale, without rebuilding node data. */
export function CanvasZoomStyle() {
  const store = useStoreApi();
  const scope = useId();
  const stylesheet = useRef<HTMLStyleElement>(null);
  useLayoutEffect(() => {
    let owner: HTMLDivElement | null = null;
    const detach = () => {
      if (owner?.dataset.canvasZoom === scope) delete owner.dataset.canvasZoom;
    };
    const update = () => {
      const { domNode, transform } = store.getState();
      if (owner !== domNode) {
        detach();
        owner = domNode;
        if (owner) owner.dataset.canvasZoom = scope;
      }
      const rule = stylesheet.current?.sheet?.cssRules[0] as
        | CSSStyleRule
        | undefined;
      rule?.style.setProperty('--canvas-zoom', String(transform[2]));
    };
    update();
    const unsubscribe = store.subscribe((state, previous) => {
      if (
        state.domNode !== previous.domNode ||
        state.transform[2] !== previous.transform[2]
      )
        update();
    });
    return () => {
      unsubscribe();
      detach();
    };
  }, [store, scope]);
  // Scope the variable to hit paths: inheriting it from the root invalidates every document DOM.
  return (
    <style
      ref={stylesheet}
    >{`[data-canvas-zoom="${scope}"] .drawing-node__hit { --canvas-zoom: 1; }`}</style>
  );
}

export function CanvasZoomLabel() {
  const zoom = useCanvasZoom();
  return <>{Math.round(zoom * 100)}%</>;
}
