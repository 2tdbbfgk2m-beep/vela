import ProviderSettings from './ProviderSettings'

/**
 * 侧边栏模型设置入口。
 * 测试夹具（tests/rehearsal）按 ?view=models 渲染此组件，因此保留该入口。
 */
export default function ModelSettings() {
  return (
    <div className="h-full overflow-y-auto p-4">
      <ProviderSettings embedding={false} />
    </div>
  )
}
