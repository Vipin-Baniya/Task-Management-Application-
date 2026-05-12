export function detectRuntimeMode(hostname, forcedMode) {
  if (forcedMode === 'api' || forcedMode === 'local') {
    return forcedMode;
  }

  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return 'api';
  }

  return 'local';
}
