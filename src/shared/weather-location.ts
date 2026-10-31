export interface DeviceWeatherCoordinates { latitude: number; longitude: number; accuracy: number | null }

/** Only call in response to the user's locate button. No background tracking. */
export function currentWeatherCoordinates(): Promise<DeviceWeatherCoordinates> {
  if (typeof window === "undefined" || !window.isSecureContext) return Promise.reject(new Error("浏览器定位需要 HTTPS 或本机地址，也可以直接选择城市。"));
  if (!navigator.geolocation) return Promise.reject(new Error("这个浏览器不支持定位，请直接选择城市。"));
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (!Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude) || Math.abs(coords.latitude) > 90 || Math.abs(coords.longitude) > 180) {
        reject(new Error("未取得有效位置，请重试或直接选择城市。")); return;
      }
      resolve({ latitude: Math.round(coords.latitude * 100) / 100, longitude: Math.round(coords.longitude * 100) / 100, accuracy: Number.isFinite(coords.accuracy) && coords.accuracy >= 0 ? Math.round(coords.accuracy) : null });
    }, (error) => {
      const messages: Record<number, string> = {
        1: "定位未获授权。可在浏览器网站设置中允许定位，或直接选择城市。",
        2: "暂时无法获取位置。请检查系统定位服务，或直接选择城市。",
        3: "获取位置超时。可以重试，或直接选择城市。",
      };
      reject(new Error(messages[error.code] ?? "定位暂时不可用，请直接选择城市。"));
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
  });
}
