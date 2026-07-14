# Levis 功能演示

欢迎!这是一份内置的演示文档,展示 Levis 支持的 Markdown 渲染能力。它只是一份未保存的草稿——放心随意编辑试玩,关闭时不保存即可。

> [!TIP]
> 按 `Cmd+/` 可以在所见即所得与源码模式之间切换,对照查看任何示例的原始写法。

## 行内标记

**粗体**、*斜体*、***粗斜体***、~~删除线~~、==高亮==,以及 `行内代码`。

链接写法:[Levis 仓库](https://github.com/CatVinci-Studio/Levis)。行内 HTML 也会渲染,比如键盘按键 <kbd>Cmd</kbd> + <kbd>S</kbd>。

行内数学公式:质能方程 $E = mc^2$,欧拉恒等式 $e^{i\pi} + 1 = 0$。

## 标题与引用

上面的就是一级、二级标题。引用块:

> 引用的文字可以嵌套其他标记,比如 **粗体** 和 `代码`。

GitHub 风格的提示块:

> [!NOTE]
> 这是一条备注,适合补充说明。

> [!WARNING]
> 这是一条警告,提醒需要留意的地方。

## 列表

- 无序列表
- 支持嵌套
  - 二级条目
  - 另一个二级条目

1. 有序列表
2. 第二项

任务清单(直接点击勾选框即可切换):

- [x] 已完成的事项
- [ ] 待办事项

## 表格

| 功能 | 语法 | 效果 |
| --- | --- | --- |
| 粗体 | `**文字**` | **文字** |
| 高亮 | `==文字==` | ==文字== |
| 行内公式 | `$x^2$` | $x^2$ |

把鼠标悬停在表格上可以增删行列。

## 代码块

带语法高亮的围栏代码块(在代码块右上角可切换语言):

```python
def fib(n: int) -> int:
    """经典的斐波那契数列。"""
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
```

```rust
fn main() {
    let greeting = "你好,Levis!";
    println!("{greeting}");
}
```

## 数学公式块

用 `$$` 包裹的块级公式由 KaTeX 渲染:

$$
\int_{-\infty}^{\infty} e^{-x^2} \, dx = \sqrt{\pi}
$$

## 图表(Mermaid)

`mermaid` 代码块会实时渲染成图表。流程图:

```mermaid
flowchart LR
    A[写 Markdown] --> B{需要图表?}
    B -- 是 --> C[画个 Mermaid]
    B -- 否 --> D[继续写]
    C --> D
```

甘特图:

```mermaid
gantt
    title 项目排期示例
    dateFormat YYYY-MM-DD
    section 设计
    需求梳理      :done,    des1, 2026-07-01, 5d
    界面设计      :active,  des2, after des1, 7d
    section 开发
    核心功能      :         dev1, after des2, 10d
    打磨与测试    :         dev2, after dev1, 5d
```

时序图:

```mermaid
sequenceDiagram
    participant 你
    participant Levis
    你->>Levis: 输入 Markdown
    Levis-->>你: 实时渲染
```

## 图片

从剪贴板直接粘贴图片,Levis 会把它保存到文档旁的 `assets/` 目录并插入引用;也可以手写:

```markdown
![描述文字](assets/screenshot.png)
```

## 脚注与分隔线

脚注写法像这样[^1],下面是一条水平分隔线:

---

[^1]: 脚注内容会集中显示在文档末尾。

祝写作愉快!
