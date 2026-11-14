const embeddedGlbData =
  /^(?:data:)(?:image\/(?:png|jpeg|webp|avif|gif|bmp)|application\/(?:octet-stream|gltf-buffer));base64,/i;

export function glbJsonBytes(header: Uint8Array, length: number) {
  const view = new DataView(
    header.buffer,
    header.byteOffset,
    header.byteLength,
  );
  if (
    view.byteLength < 20 ||
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== length ||
    view.getUint32(16, true) !== 0x4e4f534a
  )
    throw Error('GLB 2.0 파일의 헤더를 확인해주세요.');
  const size = view.getUint32(12, true);
  if (size < 2 || size % 4 !== 0 || size > length - 20)
    throw Error('GLB 2.0 JSON 청크 크기를 확인해주세요.');
  return size;
}

export function validateGlbJson(json: string) {
  const data = JSON.parse(json) as {
    asset?: { version?: string };
    buffers?: { uri?: string }[];
    images?: { uri?: string }[];
    extensionsUsed?: string[];
    extensionsRequired?: string[];
  };
  if (data?.asset?.version !== '2.0')
    throw Error('GLB 2.0 파일의 에셋 버전을 확인해주세요.');
  if (
    [...(data.buffers ?? []), ...(data.images ?? [])].some(
      (item) =>
        item.uri !== undefined &&
        (typeof item.uri !== 'string' || !embeddedGlbData.test(item.uri)),
    )
  )
    throw Error('텍스처와 버퍼를 포함한 단일 GLB로 다시 내보내주세요.');
  if (
    [...(data.extensionsUsed ?? []), ...(data.extensionsRequired ?? [])].some(
      (extension) =>
        /^(?:KHR_draco_mesh_compression|KHR_texture_basisu|(?:EXT|KHR)_meshopt_compression)$/.test(
          extension,
        ),
    )
  )
    throw Error('Draco·Meshopt·KTX2 압축을 끄고 GLB로 다시 내보내주세요.');
}
