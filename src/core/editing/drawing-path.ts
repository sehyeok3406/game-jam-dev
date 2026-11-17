export const DRAWING_DIRECTORY = '.canvas/drawings';

export const isDrawingPath = (path: string) =>
  /^\.canvas\/drawings\/[a-zA-Z0-9_-]{1,100}\.json$/.test(path);

export const drawingPath = (canvasId: string) => {
  const path = `${DRAWING_DIRECTORY}/${canvasId}.json`;
  if (!isDrawingPath(path))
    throw new Error('그림 캔버스 ID가 올바르지 않습니다.');
  return path;
};
