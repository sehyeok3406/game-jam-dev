import { useRuntime } from '../runtime/RuntimeProvider';
import { useState, useEffect, useLayoutEffect } from 'react';
import { useCanvasResource } from '../canvas/CanvasContent';
import { useOptionalCanvasViewport } from '../canvas/CanvasViewport';
import { useNodeId } from '@xyflow/react';

type ImageProps = {
  path: string;
  title: string;
  cacheKey: string;
  version?: number | string;
  onAspect?: (key: string, aspect: number) => void;
};
type PreparedImage = { url: string; bytes: number; aspect: number };

async function prepareImage(
  content: string,
  signal: AbortSignal,
): Promise<PreparedImage> {
  const image = new Image();
  image.src = content;
  await image.decode();
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const aspect = image.naturalWidth / image.naturalHeight;
  const scale = Math.min(
    1,
    768 / Math.max(image.naturalWidth, image.naturalHeight),
  );
  if (scale === 1)
    return {
      url: content,
      aspect,
      bytes: image.naturalWidth * image.naturalHeight * 4 + content.length * 2,
    };
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL('image/png');
  const bytes = canvas.width * canvas.height * 4 + url.length * 2;
  canvas.width = canvas.height = 0;
  return { url, bytes, aspect };
}

function CanvasProjectImage({
  path,
  title,
  cacheKey,
  version,
  onAspect,
}: ImageProps) {
  const { api } = useRuntime();
  const prepared = useCanvasResource(
    `image:${path}`,
    [path, version ?? cacheKey],
    async (signal) => {
      const content = await api.editor.readAsset(path);
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      return prepareImage(content, signal);
    },
    (value) => value.bytes,
    !!onAspect,
  );
  const aspect = prepared.value?.aspect;
  useLayoutEffect(() => {
    if (aspect !== undefined) onAspect?.(cacheKey, aspect);
  }, [aspect, cacheKey, onAspect]);
  if (!prepared.value)
    return (
      <span className="project-image-placeholder">
        {prepared.error ? '이미지를 찾을 수 없습니다.' : '이미지 불러오는 중…'}
        {prepared.error && <button onClick={prepared.retry}>다시 시도</button>}
      </span>
    );
  return (
    <img
      className="project-image"
      src={prepared.value.url}
      alt={title}
      draggable={false}
    />
  );
}

export function ProjectImage(props: ImageProps) {
  const store = useOptionalCanvasViewport(),
    id = useNodeId();
  return store && id ? (
    <CanvasProjectImage {...props} />
  ) : (
    <StandaloneProjectImage {...props} />
  );
}

function StandaloneProjectImage({ path, title, cacheKey }: ImageProps) {
  const { api } = useRuntime();

  const [loaded, setLoaded] = useState<{
    path: string;
    content: string;
  } | null>(null);
  const content = loaded?.path === path ? loaded.content : null;
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    setError('');
    api.editor
      .readAsset(path)
      .then((data) => {
        if (!disposed) setLoaded({ path, content: data });
      })
      .catch(() => {
        if (!disposed)
          setError(
            '이미지를 찾을 수 없습니다. 연결 상태와 원본 파일을 확인해주세요.',
          );
      });
    return () => {
      disposed = true;
    };
  }, [path, cacheKey]);
  if (!content)
    return (
      <span className="project-image-placeholder">
        {error || '이미지 불러오는 중…'}
      </span>
    );
  return (
    <img
      className="project-image"
      src={content}
      alt={title}
      draggable={false}
      onError={() => {
        setLoaded(null);
        setError('이미지를 표시할 수 없습니다.');
      }}
    />
  );
}
