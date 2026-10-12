import FeedRankingConfig from '../FeedRankingConfig.jsx'
import DistributionExperiments from '../DistributionExperiments.jsx'
import '../ui/admin.css'

// The feed ranking and distribution experiment controls. They used to sit at
// the bottom of the old Overview page; they are unchanged and now have their
// own entry under Analytics.
export default function FeedRankingSection() {
  return (
    <div className="adm-page">
      <div className="adm-head"><h1>Feed ranking</h1></div>
      <FeedRankingConfig />
      <DistributionExperiments />
    </div>
  )
}
