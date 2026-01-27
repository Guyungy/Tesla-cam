# 特斯拉行车记录仪查看器

参照车机新版操作界面，实现网格视图查看、事件点跳转、时间步进。

## 功能亮点

- 区分手动保存还是 aeb 事件触发保存
- 查看事件地点位置
- 空格键播放/暂停，左右方向键前后跳转 5 秒，快速定位关键片段
- 支持设置入点/出点导出最多 60 秒片段，优先生成 MP4（不支持则回退 WebM）
- 一键导出当前视图 JPG 截图

## 运行

`npm run build`

`npm run preview`

## 预览

**预览地址** <https://tesla-cam.pages.dev>

![preview](./public/preview.png)
