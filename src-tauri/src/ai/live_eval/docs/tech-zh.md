# 部署说明：日志收集服务

## 配置

服务启动前需要在 `config.yaml` 里设置以下字段：

* `endpoint`：日志上报地址
* `batch_size`：每批上报的条数，默认 `200`
* `retry`：失败重试次数，默认 `3`

```python
# Send logs in batches
def flush(buffer, client, batch_size=200):
    # Split the buffer into batches
    for i in range(0, len(buffer), batch_size):
        batch = buffer[i:i + batch_size]
        # Retry on network errors
        client.send(batch)
```

## 常见问题

如果日志上报延迟超过 5 分钟，先检查 `endpoint` 是否可以访问，再看 `batch_size` 是不是设置得太大。