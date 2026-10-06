import AdminPageHeader from '../../ui/AdminPageHeader.jsx'
import FeedRankingConfig from '../../FeedRankingConfig.jsx'
import DistributionExperiments from '../../DistributionExperiments.jsx'

// These two panels used to sit at the bottom of the overview tab. They keep
// the same permission (`overview`), so access to them is unchanged.
export default function FeedRankingScreen() {
  return (
    <div>
      <AdminPageHeader title="Feed ranking" subtitle="How posts are ranked and which distribution experiments are running" />
      <FeedRankingConfig />
      <DistributionExperiments />
    </div>
  )
}
