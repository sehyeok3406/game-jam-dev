import { useRuntime } from '../runtime/RuntimeProvider';
import { useState, useEffect } from 'react';

export function ProjectImage({
  path,
  title,
  cacheKey,
}: {
  path: string;
  title: string;
  cacheKey: string;
}) {
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
