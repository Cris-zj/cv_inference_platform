import asyncio
import json
from pathlib import Path
from typing import List
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from fastapi import File, UploadFile, Form
import shutil
import os
import datetime
try:
    from . import inference_engine
except ImportError as e:
    inference_engine = None


BASE_DIR = Path(__file__).parent.parent
# 定义配置文件存放的绝对或相对路径
CONFIG_DIR = BASE_DIR / "configs" 
# 定义模型文件存放的绝对或相对路径
MODEL_DIR = BASE_DIR / "models" 
# 定义 users.json 的路径
USERS_FILE = BASE_DIR / "users.json"
# 定义一个临时存放前端上传图片的文件夹
UPLOAD_DIR = BASE_DIR / "uploads" / datetime.datetime.today().strftime("%Y-%m-%d")
UPLOAD_DIR.mkdir(exist_ok=True) # 如果文件夹不存在就自动创建

# 模拟内存中的任务状态字典
tasks_status = {}

app = FastAPI(title="CV Inference Platform API")

# 允许前端跨域请求
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境请替换为前端实际IP/端口
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ModelConfig(BaseModel):

    model_name: str
    model_version: str
    model_path: str
    input_names: List[str]
    output_names: List[str]
    input_sizes: List[List[int]]
    output_sizes: List[List[int]]
    nms_iou_thr: float
    score_thr: float
    min_bbox_size: int
    num_classes: int
    class_names: List[str]

class LoginRequest(BaseModel):
    username: str
    password: str


@app.post("/api/login")
async def login(credentials: LoginRequest):
    # 1. 检查文件是否存在
    if not USERS_FILE.exists():
        raise HTTPException(status_code=500, detail="Server configuration error")

    # 2. 读取最新的账号密码信息
    with open(USERS_FILE, "r", encoding="utf-8") as f:
        valid_users = json.load(f)

    # 3. 核心校验逻辑
    input_user = credentials.username
    input_pass = credentials.password

    if input_user in valid_users and valid_users[input_user] == input_pass:
        # 校验成功！签发一个 Token 给前端
        # （这里为了极致简单，我们先发一个固定格式的假 Token，工业上这里会用 PyJWT 生成真实乱码）
        return {
            "status": "success",
            "token": f"token_for_{input_user}_888",
            "username": input_user,
            "message": "登录成功"
        }
    else:
        # 校验失败，直接踢回 401 错误码
        raise HTTPException(status_code=401, detail="用户名或密码错误")

@app.get("/api/models", response_model=List[ModelConfig])
async def get_available_models():
    """
    扫描 cpp_trt/configs 目录下的所有 .json 文件，
    解析、验证后返回给前端。
    """
    models_list = []
    
    # 检查目录是否存在
    if not CONFIG_DIR.exists() or not CONFIG_DIR.is_dir():
        raise HTTPException(status_code=404, detail="Model configuration directory not found.")

    # 遍历所有 .json 文件
    for json_file in CONFIG_DIR.glob("*.json"):
        try:
            with open(json_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                data["model_path"] = os.path.join(MODEL_DIR, data["model_path"])

                
            # 使用 Pydantic 进行严格的数据类型验证
            # 如果 JSON 里漏了字段或者类型不对（比如把数字写成了字符串），这里会自动报错并跳过
            validated_model = ModelConfig(**data)
            models_list.append(validated_model)

        except Exception as e:
            raise HTTPException(status_code=404, detail=f"读取文件时发生错误{json_file.name}")

    # 可以按模型名称排个序，保证前端展示的顺序稳定
    models_list.sort(key=lambda x: x.model_name)
    
    return models_list

@app.post("/api/inference/start")
async def start_inference(
        model_config_json: str = Form(...),
        images: List[UploadFile] = File(...)
    ):
    """
    触发推理任务。实际场景下这里会调用 C++ TRT 库，并放入后台异步任务池或 Celery。
    """

    try:
        config = json.loads(model_config_json)

        model_path = config['model_path']
        input_names = config['input_names']
        output_names = config['output_names']
        input_sizes = config['input_sizes']
        output_sizes = config['output_sizes']
        class_names = config['class_names']
        nms_iou_thr = config['nms_iou_thr']

        saved_file_paths = []
        
        # 1. 把前端传来的二进制图片流，实打实地保存到服务器硬盘上
        for image in images:
            # 拼接保存路径 (例如: backend/uploads/img_001.jpg)
            file_location = UPLOAD_DIR / image.filename
            with open(file_location, "wb+") as buffer:
                # 极其高效的文件写入方式
                shutil.copyfileobj(image.file, buffer)
            
            saved_file_paths.append(str(file_location))

        # 2. 推理
        cpp_engine_instance = inference_engine.InferenceEngine(
            model_path, 
            input_names, 
            output_names, 
            input_sizes, 
            output_sizes, 
            class_names, 
            nms_iou_thr
        )

        # 核心调用：执行 C++ 多线程推理
        cpp_results = cpp_engine_instance.infer_from_paths(saved_file_paths)
        del cpp_engine_instance
        formatted_results = []
        for i, img_result in enumerate(cpp_results):
            img_info = {
                "file_name": images[i].filename,
                "image_path": img_result.image_path,
                "metrics": {
                    "pre_process_ms": round(img_result.pre_process_ms, 2),
                    "infer_ms": round(img_result.infer_ms, 2),
                    "post_process_ms": round(img_result.post_process_ms, 2),
                    "total_ms": round(img_result.pre_process_ms + img_result.infer_ms + img_result.post_process_ms, 2)
                },
                "detections": []
            }
            for det in img_result.detections:
                img_info["detections"].append({
                    "bbox": det.bbox,
                    "score": round(float(det.score), 4),
                    "class_name": det.class_name,
                    "class_id": det.class_id
                })
            formatted_results.append(img_info)

        # 3. 将推理结果返回给前端 (目前先返回一个回执)
        return {
            "status": "success",
            "message": "图像已接收，推理任务执行完毕",
            "model_used": model_path,
            "processed_count": len(images),
            "results": formatted_results 
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail="推理引擎内部错误")
