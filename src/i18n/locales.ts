export const locales = {
  'zh-CN': {
    // TitleBar
    'titleBar.title': 'TeslaCam 查看器',
    
    // Sidebar
    'sidebar.search': '搜索日期、地点、原因...',
    'sidebar.all': '全部',
    'sidebar.sentry': '哨兵',
    'sidebar.saved': '手动',
    'sidebar.selectFolder': '选择文件夹',
    'sidebar.noResults': '没有找到相关片段',
    'sidebar.clipCount': '{total} 个片段 · {shown} 个显示',
    'sidebar.unknownLocation': '未知位置',
    
    // Viewer - Header
    'viewer.noLocation': '无位置信息',
    
    // Viewer - Controls
    'viewer.snapshot': '截图',
    'viewer.exportCsv': '导出 CSV',
    'viewer.exportClip': '导出片段',
    'viewer.exporting': '导出中...',
    'viewer.jumpToEvent': '跳转到事件',
    
    // Viewer - Keyboard hints
    'viewer.hint.playPause': 'Space: 播放/暂停',
    'viewer.hint.seek': '←→: ±5秒',
    'viewer.hint.fullscreen': 'F: 全屏',
    'viewer.hint.pip': 'P: 画中画',
    'viewer.hint.inOut': 'I/O: 入/出点',
    
    // Export Modal
    'export.title': '正在导出片段...',
    'export.processing': '处理中...',
    'export.cancel': '取消',
    
    // Toast messages
    'toast.videoSaved': '视频已保存',
    'toast.screenshotSaved': '截图已保存',
    'toast.csvExported': 'CSV 元数据已导出',
    'toast.exportFailed': '导出失败',
    'toast.exportFailedEmpty': '导出失败: 视频文件为空',
    'toast.exportFailedStart': '导出启动失败: {error}',
    'toast.exportFailedRecording': '录制过程中导出失败',
    'toast.exportError': '导出错误: {error}',
    'toast.saveFailed': '保存失败: {error}',
    'toast.screenshotFailed': '截图失败: {error}',
    'toast.noContent': '没有可导出的视频内容',
    'toast.noMetadata': '没有可用的元数据用于 CSV 导出',
    'toast.csvFailed': 'CSV 导出失败: {error}',
    
    // Home
    'home.loading': '加载中',
    'home.selectClip': '选择一个片段开始',
    
    // Start page
    'start.title': '特斯拉行车记录仪查看器',
    'start.selectHint': '请选择 TeslaCam、RecentClips、SavedClips、SentryClips 目录',
    'start.selectFolder': '选择文件夹',
    'start.noClips': '未匹配到有效视频文件，请重新选择',
    'start.localNote': '行车记录仪文件的读取分析查看均在浏览器本地运行',
    'start.notSupported': '当前浏览器不支持文件夹读取功能，请使用最新版 Chrome 浏览器访问',
    
    // Settings
    'settings.title': '设置',
    'settings.language': '语言',
    'settings.close': '关闭',
    
    // Clip types
    'clipType.manual': '手动保存',
    'clipType.aeb': 'AEB 事件',
    'clipType.sentry': '哨兵事件',
    'clipType.saved': '已保存',
    'clipType.recent': '最近',
  },
  'en': {
    // TitleBar
    'titleBar.title': 'TeslaCam Viewer',
    
    // Sidebar
    'sidebar.search': 'Search date, location, reason...',
    'sidebar.all': 'All',
    'sidebar.sentry': 'Sentry',
    'sidebar.saved': 'Saved',
    'sidebar.selectFolder': 'Select Folder',
    'sidebar.noResults': 'No matching clips found',
    'sidebar.clipCount': '{total} clips · {shown} shown',
    'sidebar.unknownLocation': 'Unknown location',
    
    // Viewer - Header
    'viewer.noLocation': 'No location info',
    
    // Viewer - Controls
    'viewer.snapshot': 'Snapshot',
    'viewer.exportCsv': 'Export CSV',
    'viewer.exportClip': 'Export Clip',
    'viewer.exporting': 'Exporting...',
    'viewer.jumpToEvent': 'Jump to Event',
    
    // Viewer - Keyboard hints
    'viewer.hint.playPause': 'Space: Play/Pause',
    'viewer.hint.seek': '←→: ±5s',
    'viewer.hint.fullscreen': 'F: Fullscreen',
    'viewer.hint.pip': 'P: PiP',
    'viewer.hint.inOut': 'I/O: In/Out',
    
    // Export Modal
    'export.title': 'Exporting Clip...',
    'export.processing': 'Processing...',
    'export.cancel': 'Cancel',
    
    // Toast messages
    'toast.videoSaved': 'Video saved',
    'toast.screenshotSaved': 'Screenshot saved',
    'toast.csvExported': 'CSV metadata exported',
    'toast.exportFailed': 'Export failed',
    'toast.exportFailedEmpty': 'Export failed: Empty video file',
    'toast.exportFailedStart': 'Export failed to start: {error}',
    'toast.exportFailedRecording': 'Export failed during recording',
    'toast.exportError': 'Export error: {error}',
    'toast.saveFailed': 'Save failed: {error}',
    'toast.screenshotFailed': 'Screenshot failed: {error}',
    'toast.noContent': 'No video content to export',
    'toast.noMetadata': 'No metadata available for CSV export',
    'toast.csvFailed': 'CSV export failed: {error}',
    
    // Home
    'home.loading': 'Loading Footage',
    'home.selectClip': 'Select a Clip to Begin',
    
    // Start page
    'start.title': 'Tesla Dashcam Viewer',
    'start.selectHint': 'Select a TeslaCam, RecentClips, SavedClips, or SentryClips directory',
    'start.selectFolder': 'Select Folder',
    'start.noClips': 'No valid video files found, please try again',
    'start.localNote': 'All file reading and analysis runs locally in your browser',
    'start.notSupported': 'Your browser does not support folder reading. Please use the latest Chrome browser.',
    
    // Settings
    'settings.title': 'Settings',
    'settings.language': 'Language',
    'settings.close': 'Close',
    
    // Clip types
    'clipType.manual': 'Manual',
    'clipType.aeb': 'AEB Event',
    'clipType.sentry': 'Sentry',
    'clipType.saved': 'Saved',
    'clipType.recent': 'Recent',
  },
} as const;

export type Locale = keyof typeof locales;
export type TranslationKey = keyof typeof locales['en'];
