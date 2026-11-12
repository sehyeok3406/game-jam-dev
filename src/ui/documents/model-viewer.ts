import {
  AnimationMixer,
  Box3,
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  LoopOnce,
  LoopRepeat,
  LoadingManager,
  MOUSE,
  PerspectiveCamera,
  Scene,
  SkeletonHelper,
  Sphere,
  TOUCH,
  Vector3,
  WebGLRenderer,
  type AnimationAction,
  type AnimationClip,
  type BufferGeometry,
  type Material,
  type Mesh,
  type Object3D,
  type Texture,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

type Format = 'glb' | 'fbx' | 'obj';
const blankTexture =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/X2QAAAAASUVORK5CYII=';

const embeddedData = (url: string) =>
  /^data:(?:image\/(?:png|jpeg|webp|avif|gif|bmp)|application\/(?:octet-stream|gltf-buffer));base64,/i.test(
    url,
  );

function validateGlb(bytes: ArrayBuffer) {
  const view = new DataView(bytes);
  if (
    bytes.byteLength < 20 ||
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.byteLength ||
    view.getUint32(16, true) !== 0x4e4f534a
  )
    throw Error('GLB 2.0 파일을 읽을 수 없습니다. 원본 파일을 확인해주세요.');
  const json = JSON.parse(
    new TextDecoder().decode(
      new Uint8Array(bytes, 20, view.getUint32(12, true)),
    ),
  ) as {
    buffers?: { uri?: string }[];
    images?: { uri?: string }[];
    extensionsUsed?: string[];
  };
  if (
    [...(json.buffers ?? []), ...(json.images ?? [])].some(
      (item) => typeof item.uri === 'string' && !embeddedData(item.uri),
    )
  )
    throw Error(
      '외부 리소스가 연결된 GLB입니다. 텍스처와 버퍼를 포함한 단일 GLB로 다시 내보내주세요.',
    );
  if (
    json.extensionsUsed?.some((extension) =>
      /^(?:KHR_draco_mesh_compression|KHR_texture_basisu|(?:EXT|KHR)_meshopt_compression)$/.test(
        extension,
      ),
    )
  )
    throw Error(
      '압축 디코더가 필요한 GLB입니다. Draco·Meshopt·KTX2 압축을 끄고 다시 내보내주세요.',
    );
}

function disposeObjects(roots: Object3D[]) {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  const images = new Set<ImageBitmap>();
  for (const root of roots)
    root.traverse((object) => {
      const mesh = object as Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      for (const material of Array.isArray(mesh.material)
        ? mesh.material
        : mesh.material
          ? [mesh.material]
          : []) {
        materials.add(material);
        for (const value of Object.values(material)) {
          if (!(value as Texture | null)?.isTexture) continue;
          const texture = value as Texture;
          textures.add(texture);
          if (texture.image instanceof ImageBitmap) images.add(texture.image);
        }
      }
      const skinned = object as import('three').SkinnedMesh;
      if (skinned.isSkinnedMesh) skinned.skeleton.dispose();
    });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
  for (const image of images) image.close();
}

export async function startModelViewer(
  host: HTMLElement,
  url: string,
  format: Format,
  signal: AbortSignal,
  update: (time: number, playing: boolean) => void,
  onError: (message: string) => void,
) {
  let redraw = () => {};
  let missingTextures = false;
  const blobs = new Set<string>();
  const manager = new LoadingManager();
  manager.onLoad = () => redraw();
  manager.setURLModifier((resource) => {
    if (resource.startsWith('blob:')) {
      blobs.add(resource);
      return resource;
    }
    if (embeddedData(resource)) return resource;
    if (format !== 'fbx')
      throw Error('텍스처를 포함한 단일 GLB로 다시 내보내주세요.');
    missingTextures = true;
    return blankTexture;
  });
  const response = await fetch(url, { signal });
  if (!response.ok) throw Error('프로젝트에서 모델 원본을 읽을 수 없습니다.');
  const bytes = await response.arrayBuffer();
  signal.throwIfAborted();
  let model: Object3D | undefined;
  let otherScenes: Object3D[] = [];
  let clips: AnimationClip[] = [];
  let renderer: WebGLRenderer | undefined;
  let scene: Scene | undefined;
  let controls: OrbitControls | undefined;
  let observer: ResizeObserver | undefined;
  let frame = 0;
  let mixer: AnimationMixer | undefined;
  function dispose() {
    cancelAnimationFrame(frame);
    redraw = () => {};
    observer?.disconnect();
    controls?.dispose();
    mixer?.stopAllAction();
    if (model) mixer?.uncacheRoot(model);
    const active = scene ?? model;
    disposeObjects(active ? [active, ...otherScenes] : otherScenes);
    for (const blob of blobs) URL.revokeObjectURL(blob);
    renderer?.domElement.remove();
    renderer?.dispose();
    renderer?.forceContextLoss();
  }

  try {
    if (format === 'glb') {
      validateGlb(bytes);
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      signal.throwIfAborted();
      const gltf = await new GLTFLoader(manager).parseAsync(bytes, '');
      model = gltf.scene;
      clips = gltf.animations;
      otherScenes = gltf.scenes.filter((alternate) => alternate !== model);
    } else if (format === 'fbx') {
      const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
      signal.throwIfAborted();
      const loader = new FBXLoader(manager);
      loader.trimAnimationClips = true;
      model = loader.parse(bytes, '');
      clips = model.animations;
    } else {
      const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
      signal.throwIfAborted();
      model = new OBJLoader(manager).parse(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      );
    }
    signal.throwIfAborted();
    clips = clips.filter(
      (clip) => clip.duration > 0 && Number.isFinite(clip.duration),
    );
    scene = new Scene();
    scene.background = new Color('#171b25');
    scene.add(model, new HemisphereLight(0xffffff, 0x41495f, 2.2));
    const key = new DirectionalLight(0xfff5ea, 2.6);
    key.position.set(3, 6, 5);
    const fill = new DirectionalLight(0xa0b9ff, 1.5);
    fill.position.set(-5, 2, -3);
    scene.add(key, fill);
    const bounds = new Box3();
    const bones: Vector3[] = [];
    let geometry = false;
    model.updateMatrixWorld(true);
    model.traverseVisible((object) => {
      if ((object as Mesh).geometry?.attributes.position?.count) {
        geometry = true;
        bounds.expandByObject(object);
      } else if ((object as import('three').Bone).isBone) {
        bones.push(object.getWorldPosition(new Vector3()));
      }
    });
    if (!geometry && bones.length) {
      bounds.setFromPoints(bones);
      scene.add(new SkeletonHelper(model));
    }
    if (bounds.isEmpty())
      throw Error('이 파일에서 표시할 메시 또는 리그를 찾을 수 없습니다.');
    const sphere = bounds.getBoundingSphere(new Sphere());
    if (!Number.isFinite(sphere.radius))
      throw Error('모델 좌표 범위를 확인해주세요.');
    const radius = Math.max(0.001, sphere.radius);
    const grid = new GridHelper(radius * 7, 28, 0x54607a, 0x30384b);
    grid.position.set(
      sphere.center.x,
      bounds.min.y - radius * 0.005,
      sphere.center.z,
    );
    scene.add(grid);
    const camera = new PerspectiveCamera(38, 1, radius / 100, radius * 70);
    try {
      renderer = new WebGLRenderer({
        antialias: true,
        powerPreference: 'default',
      });
    } catch {
      throw Error(
        '3D 미리보기에 WebGL 2가 필요합니다. 그래픽 가속 설정을 확인해주세요.',
      );
    }
    const surface = renderer;
    const world = scene;
    surface.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    host.append(surface.domElement);
    controls = new OrbitControls(camera, surface.domElement);
    const orbit = controls;
    orbit.enablePan = false;
    orbit.minDistance = radius * 0.2;
    orbit.maxDistance = radius * 25;
    let playing = false;
    let repeat = true;
    let action: AnimationAction | undefined;
    let previous = 0;
    mixer = new AnimationMixer(model);
    const animator = mixer;

    redraw = () => surface.render(world, camera);
    orbit.addEventListener('change', () => redraw());
    const fit = () => {
      const vertical = (camera.fov * Math.PI) / 360;
      const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
      const distance =
        (radius / Math.sin(Math.min(vertical, horizontal))) * 1.13;
      camera.position
        .copy(sphere.center)
        .addScaledVector(new Vector3(1, 0.55, 1.4).normalize(), distance);
      orbit.target.copy(sphere.center);
      orbit.update();
      redraw();
    };
    const size = () => {
      const { clientWidth, clientHeight } = host;
      if (!clientWidth || !clientHeight) return;
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
      surface.setSize(clientWidth, clientHeight, false);
      redraw();
    };
    observer = new ResizeObserver(size);
    observer.observe(host);
    size();
    fit();
    function notify() {
      update(action?.time ?? 0, playing);
    }
    function configureLoop() {
      action?.setLoop(repeat ? LoopRepeat : LoopOnce, repeat ? Infinity : 1);
    }
    function tick(now: number) {
      if (!playing || signal.aborted) return;
      animator.update(Math.min(0.08, (now - previous) / 1000));
      previous = now;
      redraw();
      notify();
      if (playing) frame = requestAnimationFrame(tick);
    }
    animator.addEventListener('finished', () => {
      playing = false;
      notify();
    });
    surface.domElement.addEventListener('webglcontextlost', (event) => {
      if (signal.aborted) return;
      event.preventDefault();
      playing = false;
      cancelAnimationFrame(frame);
      onError('그래픽 연결이 끊겼습니다. 3D 미리보기를 다시 열어주세요.');
    });
    function select(index: number) {
      playing = false;
      cancelAnimationFrame(frame);
      animator.stopAllAction();
      const clip = clips[index];
      action = clip && animator.clipAction(clip).reset().play();
      if (action) action.clampWhenFinished = true;
      configureLoop();
      animator.update(0);
      redraw();
      notify();
    }
    select(0);
    const preview = document.createElement('canvas');
    preview.width = 300;
    preview.height = 118;
    const snapshot = preview.getContext('2d');
    const surfaceWidth = surface.domElement.width;
    const surfaceHeight = surface.domElement.height;
    const scale = Math.min(
      preview.width / surfaceWidth,
      preview.height / surfaceHeight,
    );
    snapshot?.drawImage(
      surface.domElement,
      (preview.width - surfaceWidth * scale) / 2,
      (preview.height - surfaceHeight * scale) / 2,
      surfaceWidth * scale,
      surfaceHeight * scale,
    );

    return {
      clips: clips.map((clip, index) => ({
        name: clip.name || `클립 ${index + 1}`,
        duration: clip.duration,
      })),
      thumbnail: snapshot ? preview.toDataURL('image/webp', 0.8) : '',
      missingTextures,
      skeletonOnly: !geometry,
      grid(visible: boolean) {
        grid.visible = visible;
        redraw();
      },
      fit,
      pan(enabled: boolean) {
        orbit.enablePan = enabled;
        orbit.mouseButtons.LEFT = enabled ? MOUSE.PAN : MOUSE.ROTATE;
        orbit.touches.ONE = enabled ? TOUCH.PAN : TOUCH.ROTATE;
      },
      select,
      loop(value: boolean) {
        repeat = value;
        configureLoop();
      },
      seek(time: number) {
        if (!action) return;
        action.time = Math.min(time, action.getClip().duration);
        animator.update(0);
        redraw();
        notify();
      },
      toggle() {
        if (!action) return;
        if (playing) {
          playing = false;
          cancelAnimationFrame(frame);
        } else {
          if (action.time >= action.getClip().duration) {
            action.reset().play();
            configureLoop();
          }
          action.paused = false;
          playing = true;
          previous = performance.now();
          frame = requestAnimationFrame(tick);
        }
        notify();
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

export type ModelViewer = Awaited<ReturnType<typeof startModelViewer>>;
