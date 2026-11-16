import { useEffect, type RefObject } from 'react';

export function useActivityDraggable(container: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    const element = container.current;
    if (!element || !enabled) return;
    let destroyed = false;
    let draggable: { destroy: () => void } | null = null;
    void import('@fullcalendar/react/interaction').then(({ Draggable }) => {
      if (destroyed) return;
      draggable = new Draggable(element, {
        itemSelector: '[data-activity-id]',
        eventData: (item) => ({
          title: item.getAttribute('data-activity-title') ?? 'Atividade',
          duration: '00:30',
          backgroundColor: item.getAttribute('data-activity-color') ?? '#0F766E',
          extendedProps: { activityId: item.getAttribute('data-activity-id') },
        }),
      });
    });
    return () => {
      destroyed = true;
      draggable?.destroy();
    };
  }, [container, enabled]);
}
