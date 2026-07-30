import { Link } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { PageHeader, uiStyles } from '../components/ui'

export default function NotFoundPage() {
  return (
    <div className={uiStyles.page}>
      <PageHeader
        eyebrow="ENTRY NOT FOUND"
        title="这页不在账册里"
        description="地址可能已变更，或当前管理版本尚未开放该入口。"
        actions={<Link className={`${uiStyles.button} ${uiStyles.secondary}`} to="/"><ArrowLeft size={16} />返回运营总览</Link>}
      />
    </div>
  )
}
