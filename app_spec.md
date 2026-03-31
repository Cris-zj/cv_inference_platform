这份需求文档已经结合了我们之前确定的架构方案（B/S架构、SSE进度推送、断线自动取消、Canvas/SVG前端高性能渲染），并严格融入了你最新补充的模型表格展示与具体参数加载机制。

以下是为你生成的最终版、详尽且可直接拷贝的 `xml` 格式项目需求规格说明书：

```xml
<project_specification>
  <project_name>CV Model Inference & Visualization Web Platform</project_name>

  <overview>
    本项目是一个基于 B/S 架构的纯 Web 前端计算机视觉模型推理与结果分析平台，专为电力巡检及相关视觉检测场景设计。系统提供完整的端到端工作流：从内部账号登录鉴权，到配置化参数驱动的模型选择（输电场景的5大核心模型），再到支持 GPU 加速与并发处理的图片/文件夹批量推理。系统重点打造了基于前后端分离的毫秒级可视化交互体验，支持画布无级缩放、拖拽漫游、实时阈值/类别筛选，并提供标准的单图及批量压缩包导出方案。
  </overview>

  <technology_stack>
    <frontend>
      <framework>React 18 或 Vue 3</framework>
      <language>TypeScript (用于严格的静态类型检查，保障复杂数据结构的稳定性)</language>
      <rendering>HTML5 Canvas 或 SVG (用于实现高性能的缩放、拖拽与边界框实时绘制)</rendering>
      <state_management>Redux / Pinia (用于跨组件共享文件列表、过滤条件与图像数据)</state_management>
      <styling>Tailwind CSS (构建现代化、响应式的管理后台 UI)</styling>
    </frontend>
    <backend>
      <framework>Python Web 框架 (强烈推荐 FastAPI，原生支持异步 IO 与 SSE，性能极佳)</framework>
      <inference_engine>C++ 编译的 TensorRT (TRT) 动态链接库 (.so/.dll)</inference_engine>
      <bridge>Python 通过 ctypes、pybind11 或 cffi 调用 C++ 接口</bridge>
      <acceleration>远程服务器 GPU 硬件加速支持</acceleration>
    </backend>
    <communication>
      <protocol>HTTP/HTTPS (RESTful API 设计风格)</protocol>
      <real_time>SSE (Server-Sent Events，用于轻量级、单向的推理进度实时推送)</real_time>
    </communication>
  </technology_stack>

  <core_features>
    <authentication>
      - 访问控制：轻量级内部工具鉴权，使用 IP + 端口号通过浏览器访问。
      - 账号体系：无需复杂数据库，后端通过配置文件或硬编码设定固定用户名和密码。
      - 拦截机制：路由拦截，未登录用户强制跳转至登录页（Page 1）。
    </authentication>

    <model_inference>
      - 模型管理：内置 5 个输电场景专用模型（输电缺陷、输电小金具缺陷、输电通道、输电仿线缺陷、输电自适应）。
      - 参数联动：选中模型后，自动加载对应的配置参数。参数结构需符合：`{"class_names": ["类别1", "类别2"], "nms_iou_thr": 0.5, "score_thr": 0.5, "min_bbox_size": 20}`。
      - 数据导入：支持原生 `<input type="file">` 导入单张图片，以及 `<input type="file" webkitdirectory>` 导入整个文件夹。
      - 执行策略：采用“先上传到服务器 -> 服务器推理 -> 前端拉取结果展示”交互模式。
      - 异步并发：后端利用多线程/异步机制处理批量图片推理，避免阻塞主进程，保证 Web 界面不卡顿。
      - 进度监控：前端通过 SSE 连接实时接收进度百分比并渲染进度条。
      - 容错机制：若用户在推理过程中（如 50% 进度时）刷新或关闭网页，SSE 断开，后端需捕获断连事件并自动 cancel 后台推理任务，释放服务器 GPU 资源。
    </model_inference>

    <result_visualization>
      - 数据解耦渲染：后端不返回渲染后的图片，而是返回原图 URL 及全量检测框 JSON 数据（包含类别、坐标、原始置信度）。
      - 动态过滤：前端基于 Canvas/SVG，根据用户设置的“类别筛选”和“置信度阈值（默认 0.5）”，在原图上重新绘制满足条件的框，实现毫秒级无延迟反馈。
      - 统计面板：实时展示图片原始尺寸（长宽分辨率）及当前画面中各目标类别的检出数量。
    </result_visualization>

    <result_export>
      - 单张保存：前端将当前带有绘制框的 Canvas 转换为 DataURL (Blob/Base64)，触发浏览器默认下载行为，保存至系统默认“下载”目录。
      - 批量保存：用户输入统一的置信度阈值和类别（默认 0.5，全部类别）并选择批量导出。前端将选定的文件列表和参数发给后端，后端在服务器重新生成画好框的图片，打包成 `.zip` 压缩包并返回文件流，前端触发下载。
    </result_export>
  </core_features>

  <visualization_interactions>
    <viewport_controls>
      - 滚轮缩放：当鼠标滚轮滚动时，以鼠标当前屏幕指针坐标为中心，对画面进行平滑放大或缩小。
      - 拖拽漫游：当鼠标在画布区域按下并拖拽时，画面随鼠标移动轨迹进行平移漫游。
    </viewport_controls>
    <bounding_box_styling>
      - 标签常驻：无论用户是否点击或悬停，只要检测框满足过滤条件，其对应的【类别名称】和【置信度】必须随框体一起展示。
      - 视觉规范：标签文字必须使用“白色字体” (#FFFFFF)，标签背景必须使用“黑色半透明背景” (如 rgba(0,0,0,0.6))，以确保在各种复杂亮暗背景下均清晰可读。
    </bounding_box_styling>
  </visualization_interactions>

  <ui_layout>
    <page_1_login>
      - 布局：全屏背景，居中卡片式登录框。
      - 元素：系统标题、用户名输入框、密码输入框（掩码显示）、登录按钮。
    </page_1_login>

    <page_2_inference>
      - 模型选择区：使用【表格框】(Table) 形式展示多种模型（字段包括：模型名称、包含类别数、NMS阈值、得分阈值、最小框尺寸等）。用户点击表格的单行选中对应模型，并高亮显示。
      - 数据导入区：提供“选择单图”和“选择文件夹”两个独立按钮或拖拽上传热区。文件选中后显示已选文件数量。
      - 执行区：醒目的“开始推理”按钮。
      - 进度反馈区：点击开始后，显示进度条（百分比）、“正在推理中”文案。完成后显示“推理完成”并提供跳转到结果页的按钮。
    </page_2_inference>

    <page_3_results>
      - 左侧边栏 (导航与控制)：
        - 上半部：图片资源树/列表，显示文件名及对应缩略图。点击列表项，右侧主视图切换图片。
        - 下半部：控制面板。包含“筛选类别”组件（多选框Checkbox列表，默认全选）和“置信度阈值”组件（滑块 Slider + 步进输入框，默认 0.5）。
      - 右侧主视口 (展示与交互)：
        - 顶部信息栏：显示当前选中图像的原始尺寸 (如 1920x1080)；动态显示各类别的检出数量（如：绝缘子破损: 2, 防震锤滑移: 1）。
        - 核心可视化区：占满主视图区域的 Canvas/SVG 画布，承载缩放、拖拽和检测框渲染逻辑。
      - 操作动作条：
        - “单张保存”按钮（依赖当前前端视图直接导出）。
        - “批量一键保存”按钮（弹窗二次确认过滤参数后请求后端打包 ZIP）。
    </page_3_results>
  </ui_layout>

  <api_endpoints_summary>
    <auth>
      - POST /api/auth/login (鉴权并返回 Token)
    </auth>
    <model_inference>
      - GET /api/models (获取支持的5个模型列表及其对应的默认参数 JSON)
      - POST /api/inference/upload (图片/文件夹数据预上传至服务器临时目录)
      - POST /api/inference/start (携带模型ID和文件路径，触发 C++ TRT 推理任务)
      - GET /api/inference/progress (SSE 接口，建立长连接实时推送任务进度百分比)
      - POST /api/inference/cancel (用户主动取消或 SSE 断开时触发，清理 GPU 任务)
    </model_inference>
    <data_retrieval>
      - GET /api/inference/results/:taskId (获取原图静态资源 URL 以及对应的边界框 JSON 数据)
    </data_retrieval>
    <export>
      - POST /api/export/batch (提交文件清单与设定阈值/类别，返回 ZIP 文件流)
    </export>
  </api_endpoints_summary>

  <implementation_steps>
    <step number="1">
      <title>环境初始化与鉴权模块</title>
      <tasks>搭建 React/Vue 前端工程与 FastAPI 后端工程；配置系统静态账号密码；完成 Page 1 登录拦截器与 UI 开发。</tasks>
    </step>
    <step number="2">
      <title>底层核心链路打通</title>
      <tasks>实现 Python 封装 C++ TRT 推理接口；搭建文件上传 API；实现 SSE 服务器推送流与断开自动 Cancel 机制。</tasks>
    </step>
    <step number="3">
      <title>模型配置与推理页面 (Page 2)</title>
      <tasks>开发模型表格组件，实现点击行加载关联 JSON 参数；集成文件/文件夹上传逻辑；联调 SSE 进度条及防卡顿异步任务流。</tasks>
    </step>
    <step number="4">
      <title>高性能可视化引擎 (Page 3 核心)</title>
      <tasks>使用 Canvas API 开发图像渲染核心，实现以鼠标为中心的缩放矩阵计算、拖拽平移；实现黑底白字的检测框图层叠加。</tasks>
    </step>
    <step number="5">
      <title>数据联动与导出业务 (Page 3 业务)</title>
      <tasks>集成左侧文件列表与状态管理；实现毫秒级拖动滑块引起画布框体显隐联动；统计信息开发；实现单张前端导出及批量 ZIP 后端下载。</tasks>
    </step>
  </implementation_steps>

  <success_criteria>
    <functionality>
      - 表格模型选择、JSON参数加载准确无误。
      - 图片/文件夹上传、异步推理、进度条展示、中途取消功能闭环。
      - 单图保存与批量 ZIP 压缩下载流程畅通，导出图像包含白字黑底的过滤后边框。
    </functionality>
    <user_experience>
      - 基于前后端分离渲染策略，过滤类目或拖拽阈值滑块时，画布必须做到毫秒级更新，无请求后端的卡顿感。
      - 画布缩放以鼠标当前坐标为中心，平移拖拽跟手顺滑。
      - 数据量大时（如同时导入 500 张图），前端 UI 不被阻塞，依然响应点击。
    </user_experience>
    <technical_quality>
      - 前端 TypeScript 类型定义严密，无 Any 滥用。
      - 后端 Python 异步任务管理健壮，有效避免连接意外断开导致的 GPU 显存泄漏（OOM）。
    </technical_quality>
  </success_criteria>
</project_specification>
```