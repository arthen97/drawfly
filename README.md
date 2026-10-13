# Drawfly Real Env + MaleCNS

## 真假对照

| 层 | 之前 | 现在 |
|----|------|------|
| 决策 | GPT-6 或 stub | **默认 MaleCNS v1.0（stonkfly FlyController）** |
| 连接组 | 假点云 | **166,700 神经元 / 25.6M 边** |
| 解码 | 假仪表 | **真实 DNp20 L/R + DNpe017 gate** |
| 环境 | 连续纸面 | 连续纸面（不变） |
| GPT-6 | 主脑 | 可选后端 / 图未就绪时回退 |

## 准备 MaleCNS（只需一次）

```bash
cd /Users/arthen01/drawfly
python3.11 -m venv .venv
source .venv/bin/activate
pip install numpy pandas pyarrow Pillow pydantic python-dotenv
pip install -e ./vendor/stonkfly --no-deps
export STONKFLY_DATA=/Users/arthen01/drawfly/data
cd vendor/stonkfly
STONKFLY_DATA=/Users/arthen01/drawfly/data python -m stonkfly prepare
```

会下载 Janelia/Google 发布的 feather，并编译 `graph.npz` + C++ kernel。

## 启动

```bash
cd /Users/arthen01/drawfly
source .venv/bin/activate
export STONKFLY_DATA=/Users/arthen01/drawfly/data
# Merouter 仅在选择 gpt6 后端时需要
python server.py
```

打开 http://127.0.0.1:8765 ，后端选 **MaleCNS 真实连接组**。

## 接口

- `GET /api/health` → `malecns_ready`
- `POST /api/decide` `{ backend: "malecns"|"gpt6", reinforcement, observation }`
- MaleCNS 返回 `neural.left_hz/right_hz/total_spikes/...`
