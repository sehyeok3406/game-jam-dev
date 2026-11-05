process.env.CAMERA_VIEWPORT_TEST = '1';
process.env.CAMERA_CONTENT_TEST = '1';
await import('./run-camera-performance-ui.mjs');
