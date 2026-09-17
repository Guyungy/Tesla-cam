export const locales = {
  'zh-CN': {
    // TitleBar
    'titleBar.title': 'TeslaCam 查看器',

    // Sidebar
    'sidebar.search': '搜索日期、地点、原因...',
    'sidebar.all': '全部',
    'sidebar.recent': '最近',
    'sidebar.sentry': '哨兵',
    'sidebar.saved': '手动',
    'sidebar.selectFolder': '选择文件夹',
    'sidebar.noResults': '没有找到相关片段',
    'sidebar.clipCount': '{total} 个片段 · {shown} 个显示',
    'sidebar.unknownLocation': '未知位置',
    'sidebar.today': '今天',
    'sidebar.yesterday': '昨天',

    // Viewer - Header
    'viewer.noLocation': '无位置信息',
    'viewer.codecUnsupported':
      '该片段为 H.265 / HEVC 编码，暂不支持解析行车遥测 —— 视频可正常播放，但仪表与 GPS 轨迹为空。特斯拉官方工具目前同样只支持 H.264。',

    // Viewer - Controls
    'viewer.snapshot': '截图',
    'viewer.exportCsv': '导出 CSV',
    'viewer.exportClip': '导出片段',
    'viewer.quickExportEvent': '快速导出事件 ±10秒',
    'viewer.quickExportEventHint': '导出事件发生前10秒至后10秒',
    'viewer.deleteClip': '删除片段',
    'viewer.deleting': '删除中...',
    'viewer.exporting': '导出中...',
    'viewer.jumpToEvent': '跳转到事件',
    'viewer.clearInOut': '清除',
    'viewer.hardBraking': '急刹车',

    // Trip summary
    'trip.title': '行程统计',
    'trip.hide': '收起',
    'trip.none': '未启用',
    'trip.distance': '里程',
    'trip.moving': '行驶时长',
    'trip.avgSpeed': '平均车速',
    'trip.maxSpeed': '最高车速',
    'trip.hardBraking': '急刹车',
    'trip.harshSteering': '急打方向',
    'trip.maxSteering': '最大转向',
    'trip.gearChanges': '挡位切换',
    'trip.apUsage': '辅助驾驶',
    'trip.score': '驾驶评分',
    'trip.scoreInsufficient': '数据不足',

    // Viewer - Keyboard hints
    'viewer.hint.playPause': 'Space: 播放/暂停',
    'viewer.hint.seek': '←→: ±5秒',
    'viewer.hint.fineSeek': 'Shift+←→: ±1秒',
    'viewer.hint.frameStep': ',/.: 逐帧',
    'viewer.hint.clipNav': '↑↓: 切换片段',
    'viewer.hint.fullscreen': 'F: 全屏',
    'viewer.hint.pip': 'P: 画中画',
    'viewer.hint.inOut': 'I/O: 入/出点',

    // Volume
    'viewer.mute': '静音',
    'viewer.unmute': '取消静音',

    // Timestamp format (dayjs)
    'format.timestamp': 'YYYY年MM月DD日 ddd HH:mm:ss',
    'format.dateGroup': 'YYYY年MM月DD日',
    'format.clipDate': 'MM/DD HH:mm',

    // Export Modal
    'export.title': '正在导出片段...',
    'export.processing': '处理中...',
    'export.cancel': '取消',
    'export.frames': '已捕获 {count} 帧',
    'export.eta': '预计剩余 {time}',
    'export.encoding': '正在编码...',

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
    'toast.clipDeleted': '片段已移到回收站',
    'toast.clipDeletedPermanent': '片段已永久删除（该磁盘无回收站）',
    'toast.clipDeletedPartial': '已删除 {count} 个文件，{failed} 个失败',
    'toast.deleteFailed': '删除失败: {error}',

    // Home
    'home.loading': '加载中',
    'home.loadingProgress': '正在加载素材 ({current}/{total})',
    'home.selectClip': '选择一个片段开始',

    // Left-wheel visual scan
    'wheelScan.open': '轮毂事件排查',
    'wheelScan.scanningBadge': '扫描 {percent}% · {count} 个候选',
    'wheelScan.title': '左侧轮毂事件排查',
    'wheelScan.description':
      '离线扫描左侧摄像头，找出靠近车辆的持续运动候选，按风险排序供人工复核。',
    'wheelScan.leftFront': '左前轮',
    'wheelScan.leftRear': '左后轮',
    'wheelScan.damageLocation': '受损位置',
    'wheelScan.views': '分析视角',
    'wheelScan.viewsHint': '视角越多扫描越慢；左侧摄像头通常最相关。',
    'wheelScan.camera.left': '左侧',
    'wheelScan.camera.leftPillar': '左 B 柱',
    'wheelScan.camera.front': '前方',
    'wheelScan.camera.back': '后方',
    'wheelScan.camera.right': '右侧',
    'wheelScan.camera.rightPillar': '右 B 柱',
    'wheelScan.start': '开始扫描',
    'wheelScan.cancel': '取消',
    'wheelScan.preparing': '正在准备视频…',
    'wheelScan.candidateUnit': '个候选',
    'wheelScan.reviewWhileScanning':
      '扫描仍在后台继续；现在就可以点击已发现的候选进行复核。',
    'wheelScan.empty': '选择轮毂后开始扫描，结果会显示在这里。',
    'wheelScan.cached': '已读取此前对相同文件的扫描结果。',
    'wheelScan.failed': '扫描失败',
    'wheelScan.leftCamera': '左侧摄像头',
    'wheelScan.leftPillar': '左 B 柱摄像头',
    'wheelScan.review': '复核',
    'wheelScan.movement.approaching': '正在靠近',
    'wheelScan.movement.stable': '近区停留',
    'wheelScan.movement.leaving': '正在远离',
    'wheelScan.estimatedDistance': '视觉距离',
    'wheelScan.highestRisk': '最高风险',
    'wheelScan.proximity.far': '远',
    'wheelScan.proximity.medium': '中等',
    'wheelScan.proximity.near': '近',
    'wheelScan.proximity.veryNear': '极近',
    'wheelScan.disclaimer':
      '候选来自画面运动分析，只用于缩小排查范围，不代表已经确认发生接触或确定责任。',

    // Start page
    'start.title': '特斯拉行车记录仪查看器',
    'start.selectHint':
      '请选择 TeslaCam、RecentClips、SavedClips、SentryClips 目录',
    'start.selectFolder': '选择文件夹',
    'start.noClips': '未匹配到有效视频文件，请重新选择',
    'start.localNote': '行车记录仪文件的读取分析查看均在浏览器本地运行',
    'start.notSupported':
      '当前浏览器不支持文件夹读取功能，请使用最新版 Chrome 浏览器访问',

    // Drag & Drop
    'drop.hint': '拖放 TeslaCam 文件夹到此处',

    // Settings
    'settings.title': '设置',
    'settings.language': '语言',
    'settings.close': '关闭',
    'settings.playback': '播放',
    'settings.autoAdvance': '播完自动连播下一段',
    'settings.autoSeekEvent': '打开片段自动定位到事件',
    'settings.sentryCameraFocus': '哨兵事件聚焦触发摄像头',
    'settings.export': '导出选项',
    'settings.exportTime': '显示时间',
    'settings.exportLocation': '显示位置',
    'settings.exportDriveData': '显示驾驶数据',
    'settings.exportHwAccel': '硬件加速编码（更快）',
    'settings.exportVideoWidth': '视频导出分辨率',
    'settings.exportVideoWidthHint': '截图始终最高画质',

    // Settings — maintenance
    'settings.maintenance': '维护',
    'settings.clearSeiCache': '清除遥测缓存',
    'settings.seiCacheCleared': '遥测缓存已清除',
    'settings.clearSeiCacheHint':
      '释放行车遥测缓存占用的磁盘空间，下次打开片段时会重新解析',

    // Camera labels (export overlay)
    'cam.front': '前方',
    'cam.back': '后方',
    'cam.left': '左侧',
    'cam.right': '右侧',
    'cam.left_pillar': '左B柱',
    'cam.right_pillar': '右B柱',

    // Clip types
    'clipType.manual': '手动保存',
    'clipType.aeb': 'AEB 事件',
    'clipType.sentry': '哨兵事件',
    'clipType.saved': '已保存',
    'clipType.recent': '最近',
  },
  en: {
    // TitleBar
    'titleBar.title': 'TeslaCam Viewer',

    // Sidebar
    'sidebar.search': 'Search date, location, reason...',
    'sidebar.all': 'All',
    'sidebar.recent': 'Recent',
    'sidebar.sentry': 'Sentry',
    'sidebar.saved': 'Saved',
    'sidebar.selectFolder': 'Select Folder',
    'sidebar.noResults': 'No matching clips found',
    'sidebar.clipCount': '{total} clips · {shown} shown',
    'sidebar.unknownLocation': 'Unknown location',
    'sidebar.today': 'Today',
    'sidebar.yesterday': 'Yesterday',

    // Viewer - Header
    'viewer.noLocation': 'No location info',
    'viewer.codecUnsupported':
      "This clip is H.265 / HEVC, so telemetry cannot be decoded yet — the video plays normally, but the dashboard and GPS track stay empty. Tesla's own dashcam tool is H.264-only too.",

    // Viewer - Controls
    'viewer.snapshot': 'Snapshot',
    'viewer.exportCsv': 'Export CSV',
    'viewer.exportClip': 'Export Clip',
    'viewer.quickExportEvent': 'Quick export event ±10s',
    'viewer.quickExportEventHint':
      'Export 10 seconds before and after the event',
    'viewer.deleteClip': 'Delete Clip',
    'viewer.deleting': 'Deleting...',
    'viewer.exporting': 'Exporting...',
    'viewer.jumpToEvent': 'Jump to Event',
    'viewer.clearInOut': 'Clear',
    'viewer.hardBraking': 'Hard braking',

    // Trip summary
    'trip.title': 'Trip Summary',
    'trip.hide': 'Collapse',
    'trip.none': 'Not engaged',
    'trip.distance': 'Distance',
    'trip.moving': 'Driving time',
    'trip.avgSpeed': 'Avg speed',
    'trip.maxSpeed': 'Max speed',
    'trip.hardBraking': 'Hard braking',
    'trip.harshSteering': 'Harsh steering',
    'trip.maxSteering': 'Max steering',
    'trip.gearChanges': 'Gear changes',
    'trip.apUsage': 'Autopilot',
    'trip.score': 'Drive score',
    'trip.scoreInsufficient': 'Not enough data',

    // Viewer - Keyboard hints
    'viewer.hint.playPause': 'Space: Play/Pause',
    'viewer.hint.seek': '←→: ±5s',
    'viewer.hint.fineSeek': 'Shift+←→: ±1s',
    'viewer.hint.frameStep': ',/.: Frame step',
    'viewer.hint.clipNav': '↑↓: Prev/Next clip',
    'viewer.hint.fullscreen': 'F: Fullscreen',
    'viewer.hint.pip': 'P: PiP',
    'viewer.hint.inOut': 'I/O: In/Out',

    // Volume
    'viewer.mute': 'Mute',
    'viewer.unmute': 'Unmute',

    // Timestamp format (dayjs)
    'format.timestamp': 'MMM D, YYYY ddd HH:mm:ss',
    'format.dateGroup': 'YYYY-MM-DD',
    'format.clipDate': 'MM/DD HH:mm',

    // Export Modal
    'export.title': 'Exporting Clip...',
    'export.processing': 'Processing...',
    'export.cancel': 'Cancel',
    'export.frames': '{count} frames captured',
    'export.eta': 'ETA: {time}',
    'export.encoding': 'Encoding...',

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
    'toast.clipDeleted': 'Clip moved to Recycle Bin',
    'toast.clipDeletedPermanent':
      'Clip deleted permanently (drive has no Recycle Bin)',
    'toast.clipDeletedPartial': 'Deleted {count} file(s), {failed} failed',
    'toast.deleteFailed': 'Delete failed: {error}',

    // Home
    'home.loading': 'Loading Footage',
    'home.loadingProgress': 'Loading footage ({current}/{total})',
    'home.selectClip': 'Select a Clip to Begin',

    // Left-wheel visual scan
    'wheelScan.open': 'Wheel incident scan',
    'wheelScan.scanningBadge': 'Scanning {percent}% · {count} candidates',
    'wheelScan.title': 'Left-wheel incident scan',
    'wheelScan.description':
      'Scan left camera footage offline for sustained nearby motion and rank moments for manual review.',
    'wheelScan.leftFront': 'Left front',
    'wheelScan.leftRear': 'Left rear',
    'wheelScan.damageLocation': 'Damage',
    'wheelScan.views': 'Views',
    'wheelScan.viewsHint':
      'More views take longer; the left repeater is usually most relevant.',
    'wheelScan.camera.left': 'Left',
    'wheelScan.camera.leftPillar': 'L-Pillar',
    'wheelScan.camera.front': 'Front',
    'wheelScan.camera.back': 'Rear',
    'wheelScan.camera.right': 'Right',
    'wheelScan.camera.rightPillar': 'R-Pillar',
    'wheelScan.start': 'Start scan',
    'wheelScan.cancel': 'Cancel',
    'wheelScan.preparing': 'Preparing videos…',
    'wheelScan.candidateUnit': 'candidates',
    'wheelScan.reviewWhileScanning':
      'Scanning continues in the background; you can review candidates now.',
    'wheelScan.empty':
      'Choose a wheel and start scanning. Results appear here.',
    'wheelScan.cached': 'Loaded the previous scan for these unchanged files.',
    'wheelScan.failed': 'Scan failed',
    'wheelScan.leftCamera': 'Left camera',
    'wheelScan.leftPillar': 'Left pillar camera',
    'wheelScan.review': 'Review',
    'wheelScan.movement.approaching': 'Approaching',
    'wheelScan.movement.stable': 'Dwelling nearby',
    'wheelScan.movement.leaving': 'Moving away',
    'wheelScan.estimatedDistance': 'Visual distance',
    'wheelScan.highestRisk': 'Highest risk',
    'wheelScan.proximity.far': 'Far',
    'wheelScan.proximity.medium': 'Medium',
    'wheelScan.proximity.near': 'Near',
    'wheelScan.proximity.veryNear': 'Very near',
    'wheelScan.disclaimer':
      'Candidates come from motion analysis and only narrow the review range; they do not prove contact or responsibility.',

    // Start page
    'start.title': 'Tesla Dashcam Viewer',
    'start.selectHint':
      'Select a TeslaCam, RecentClips, SavedClips, or SentryClips directory',
    'start.selectFolder': 'Select Folder',
    'start.noClips': 'No valid video files found, please try again',
    'start.localNote':
      'All file reading and analysis runs locally in your browser',
    'start.notSupported':
      'Your browser does not support folder reading. Please use the latest Chrome browser.',

    // Drag & Drop
    'drop.hint': 'Drop TeslaCam folder here',

    // Settings
    'settings.title': 'Settings',
    'settings.language': 'Language',
    'settings.close': 'Close',
    'settings.playback': 'Playback',
    'settings.autoAdvance': 'Auto-play next clip',
    'settings.autoSeekEvent': 'Jump to event when opening a clip',
    'settings.sentryCameraFocus': 'Focus triggering camera for Sentry events',
    'settings.export': 'Export Options',
    'settings.exportTime': 'Show Time',
    'settings.exportLocation': 'Show Location',
    'settings.exportDriveData': 'Show Driving Data',
    'settings.exportHwAccel': 'Hardware-accelerated encoding (faster)',
    'settings.exportVideoWidth': 'Video export resolution',
    'settings.exportVideoWidthHint': 'Screenshots stay full quality',

    // Settings — maintenance
    'settings.maintenance': 'Maintenance',
    'settings.clearSeiCache': 'Clear telemetry cache',
    'settings.seiCacheCleared': 'Telemetry cache cleared',
    'settings.clearSeiCacheHint':
      'Free the disk space used by cached driving telemetry; clips are re-parsed next time they open',

    // Camera labels (export overlay)
    'cam.front': 'Front',
    'cam.back': 'Rear',
    'cam.left': 'Left',
    'cam.right': 'Right',
    'cam.left_pillar': 'L-Pillar',
    'cam.right_pillar': 'R-Pillar',

    // Clip types
    'clipType.manual': 'Manual',
    'clipType.aeb': 'AEB Event',
    'clipType.sentry': 'Sentry',
    'clipType.saved': 'Saved',
    'clipType.recent': 'Recent',
  },
} as const;

export type Locale = keyof typeof locales;
export type TranslationKey = keyof (typeof locales)['en'];
