export function getVideoDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    // 创建视频对象
    const video = document.createElement('video');
    video.preload = 'metadata'; // 只加载元数据，不加载视频内容
    video.src = url;

    // 监听视频元数据
    video.addEventListener('loadedmetadata', () => {
      resolve(video.duration);
    });

    // 错误处理
    video.addEventListener('error', () => {
      resolve(0);
    });
  });
}
