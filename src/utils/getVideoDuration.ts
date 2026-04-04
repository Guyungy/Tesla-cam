export function getVideoDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    // 创建视频对象
    const video = document.createElement('video');
    video.preload = 'metadata'; // 只加载元数据，不加载视频内容
    video.src = url;

    const cleanup = () => {
      video.removeAttribute('src');
      video.load(); // Release resources
    };

    // 监听视频元数据
    video.addEventListener('loadedmetadata', () => {
      const duration = video.duration;
      cleanup();
      resolve(duration);
    });

    // 错误处理
    video.addEventListener('error', () => {
      cleanup();
      resolve(0);
    });

    // Timeout fallback to prevent hanging forever
    setTimeout(() => {
      cleanup();
      resolve(0);
    }, 10000);
  });
}
